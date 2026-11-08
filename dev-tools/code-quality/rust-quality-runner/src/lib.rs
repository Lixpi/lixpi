// Lixpi's Rust source conventions, decided on rust-analyzer's lossless syntax
// tree. The tree keeps comments and whitespace as tokens, so every rule finds
// its constructs through parsed nodes and rewrites only the whitespace tokens
// between them. No rule matches source text with patterns.

use ra_ap_syntax::{
    AstNode,
    Edition,
    NodeOrToken,
    SourceFile,
    SyntaxElement,
    SyntaxKind,
    SyntaxNode,
    SyntaxToken,
    TextSize,
    ast::{
        self,
        HasName,
    },
};

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub rule: &'static str,
    pub message: &'static str,
    pub offset: usize,
    pub fixable: bool,
}

#[derive(Debug)]
pub struct Report {
    pub diagnostics: Vec<Diagnostic>,

    // The source with every fixable diagnostic applied.
    pub fixed: String,
}

struct Edit {
    start: usize,
    end: usize,
    replacement: String,
}

const NO_BLOCK_COMMENTS: &str = "no-block-comments";
const STATEMENT_SPACING: &str = "statement-spacing";
const VALIDATION_IF_SPACING: &str = "validation-if-spacing";
const MATCH_ARM_SPACING: &str = "match-arm-spacing";

/// Parses `source` as Rust 2024 and checks every convention.
///
/// # Errors
///
/// Returns the first syntax error, because the rules only reason about
/// source that parses.
pub fn check(source: &str) -> Result<Report, String> {
    let parse = SourceFile::parse(source, Edition::Edition2024);
    if let Some(error) = parse.errors().first() {
        return Err(error.to_string());
    }

    let file = parse.tree();
    let mut diagnostics = Vec::new();
    let mut edits = Vec::new();

    report_block_comments(file.syntax(), &mut diagnostics);

    for statement_list in file.syntax().descendants().filter_map(ast::StmtList::cast) {
        check_statement_spacing(&statement_list, &mut diagnostics, &mut edits);
    }

    for arm_list in file.syntax().descendants().filter_map(ast::MatchArmList::cast) {
        check_match_arm_spacing(&arm_list, &mut diagnostics, &mut edits);
    }

    diagnostics.sort_by_key(|diagnostic| diagnostic.offset);

    Ok(Report {
        diagnostics,
        fixed: apply(source, edits),
    })
}

/// Converts a byte offset into a 1-based line and character column.
#[must_use]
pub fn line_column(
    source: &str,
    offset: usize,
) -> (usize, usize) {
    let before = &source[..offset.min(source.len())];
    let line = before.matches('\n').count() + 1;
    let line_start = before.rfind('\n').map_or(0, |index| index + 1);

    (line, before[line_start..].chars().count() + 1)
}

// `/* */`, `/** */` and `/*! */` all read as block comments. rustfmt's
// normalize_comments rewrites most of them; whatever it can't is reported.
fn report_block_comments(
    root: &SyntaxNode,
    diagnostics: &mut Vec<Diagnostic>,
) {
    for token in root.descendants_with_tokens().filter_map(SyntaxElement::into_token) {
        if is_comment(token.kind()) && token.text().starts_with("/*") {
            diagnostics.push(Diagnostic {
                rule: NO_BLOCK_COMMENTS,
                message: "use // comments instead of block comments",
                offset: offset(token.text_range().start()),
                fixable: false,
            });
        }
    }
}

// Block statements and terminal statements are separated from their siblings
// by one blank line, except a validation `if` that reads the value its `let`
// just bound, which stays attached to it. Nothing is inserted before the first
// statement or after the last one.
fn check_statement_spacing(
    statement_list: &ast::StmtList,
    diagnostics: &mut Vec<Diagnostic>,
    edits: &mut Vec<Edit>,
) {
    let tail = statement_list.tail_expr().map(|expression| expression.syntax().clone());
    let siblings: Vec<SyntaxNode> = statement_list
        .syntax()
        .children()
        .filter(|node| node.kind() != SyntaxKind::ATTR)
        .collect();

    for pair in siblings.windows(2) {
        let [previous, next] = pair else {
            continue;
        };

        let gap = Gap::between(previous, next);

        if is_validation_pair(previous, next) {
            if gap.has_blank_line() && gap.is_whitespace_only() {
                diagnostics.push(Diagnostic {
                    rule: VALIDATION_IF_SPACING,
                    message: "keep a validation if attached to the let statement it checks",
                    offset: offset(next.text_range().start()),
                    fixable: true,
                });
                edits.extend(gap.remove_blank_lines());
            }

            continue;
        }

        let next_is_tail = tail.as_ref() == Some(next);
        let needs_blank_line = is_block_statement(previous) || is_block_statement(next) || next_is_tail || is_terminal_statement(next);
        if needs_blank_line && !gap.has_blank_line() {
            let edit = gap.insert_blank_line();

            diagnostics.push(Diagnostic {
                rule: STATEMENT_SPACING,
                message: "separate block and terminal statements from their siblings with one blank line",
                offset: offset(next.text_range().start()),
                fixable: edit.is_some(),
            });
            edits.extend(edit);
        }
    }
}

// Match arms read as one list, the way adjacent switch cases do.
fn check_match_arm_spacing(
    arm_list: &ast::MatchArmList,
    diagnostics: &mut Vec<Diagnostic>,
    edits: &mut Vec<Edit>,
) {
    let arms: Vec<SyntaxNode> = arm_list.arms().map(|arm| arm.syntax().clone()).collect();

    for pair in arms.windows(2) {
        let [previous, next] = pair else {
            continue;
        };

        let gap = Gap::between(previous, next);
        if gap.has_blank_line() && gap.is_whitespace_only() {
            diagnostics.push(Diagnostic {
                rule: MATCH_ARM_SPACING,
                message: "keep match arms on adjacent lines without blank lines between them",
                offset: offset(next.text_range().start()),
                fixable: true,
            });
            edits.extend(gap.remove_blank_lines());
        }
    }
}

// Doc comments carry their own token kinds.
fn is_comment(kind: SyntaxKind) -> bool {
    matches!(kind, SyntaxKind::COMMENT | SyntaxKind::OUTER_DOC_COMMENT | SyntaxKind::INNER_DOC_COMMENT)
}

fn statement_expression(node: &SyntaxNode) -> Option<ast::Expr> {
    if let Some(statement) = ast::ExprStmt::cast(node.clone()) {
        return statement.expr();
    }

    ast::Expr::cast(node.clone())
}

fn is_block_statement(node: &SyntaxNode) -> bool {
    if ast::Item::can_cast(node.kind()) {
        return true;
    }

    if let Some(statement) = ast::LetStmt::cast(node.clone()) {
        return statement.let_else().is_some();
    }

    statement_expression(node).is_some_and(|expression| {
        matches!(
            expression.syntax().kind(),
            SyntaxKind::IF_EXPR
                | SyntaxKind::MATCH_EXPR
                | SyntaxKind::LOOP_EXPR
                | SyntaxKind::WHILE_EXPR
                | SyntaxKind::FOR_EXPR
                | SyntaxKind::BLOCK_EXPR
        )
    })
}

fn is_terminal_statement(node: &SyntaxNode) -> bool {
    statement_expression(node).is_some_and(|expression| {
        matches!(
            expression.syntax().kind(),
            SyntaxKind::RETURN_EXPR | SyntaxKind::BREAK_EXPR | SyntaxKind::CONTINUE_EXPR | SyntaxKind::BECOME_EXPR
        )
    })
}

// A `let` followed by an `if` whose condition reads a name the `let` bound.
fn is_validation_pair(
    previous: &SyntaxNode,
    next: &SyntaxNode,
) -> bool {
    let Some(statement) = ast::LetStmt::cast(previous.clone()) else {
        return false;
    };

    if statement.let_else().is_some() {
        return false;
    }

    let Some(ast::Expr::IfExpr(if_expression)) = statement_expression(next) else {
        return false;
    };

    let Some(condition) = if_expression.condition() else {
        return false;
    };

    let bound: Vec<String> = statement
        .pat()
        .into_iter()
        .flat_map(|pattern| pattern.syntax().descendants().filter_map(ast::IdentPat::cast).collect::<Vec<_>>())
        .filter_map(|pattern| pattern.name().map(|name| name.text().to_owned()))
        .collect();

    condition
        .syntax()
        .descendants()
        .filter_map(ast::NameRef::cast)
        .any(|reference| bound.iter().any(|name| *name == reference.text()))
}

// The tokens between two sibling nodes: whitespace and comments.
struct Gap {
    tokens: Vec<SyntaxToken>,
}

impl Gap {
    fn between(
        previous: &SyntaxNode,
        next: &SyntaxNode,
    ) -> Self {
        let mut tokens = Vec::new();
        let mut element = previous.next_sibling_or_token();

        while let Some(current) = element {
            match &current {
                NodeOrToken::Node(node) if node == next => break,
                NodeOrToken::Node(_) => {},
                NodeOrToken::Token(token) => tokens.push(token.clone()),
            }

            element = current.next_sibling_or_token();
        }

        Self {
            tokens,
        }
    }

    fn whitespace(&self) -> impl Iterator<Item = &SyntaxToken> {
        self.tokens.iter().filter(|token| token.kind() == SyntaxKind::WHITESPACE)
    }

    fn has_blank_line(&self) -> bool {
        self.whitespace().any(|token| token.text().matches('\n').count() >= 2)
    }

    fn is_whitespace_only(&self) -> bool {
        self.tokens.iter().all(|token| token.kind() == SyntaxKind::WHITESPACE)
    }

    // Adds one line break to the first whitespace that already ends a line,
    // keeping the indentation that follows it.
    fn insert_blank_line(&self) -> Option<Edit> {
        let token = self.whitespace().find(|token| token.text().contains('\n'))?;
        let range = token.text_range();

        Some(Edit {
            start: offset(range.start()),
            end: offset(range.end()),
            replacement: format!("\n{}", token.text()),
        })
    }

    fn remove_blank_lines(&self) -> Vec<Edit> {
        self.whitespace()
            .filter(|token| token.text().matches('\n').count() >= 2)
            .map(|token| {
                let text = token.text();
                let indentation = text.rfind('\n').map_or("", |index| &text[index + 1..]);
                let range = token.text_range();

                Edit {
                    start: offset(range.start()),
                    end: offset(range.end()),
                    replacement: format!("\n{indentation}"),
                }
            })
            .collect()
    }
}

fn offset(size: TextSize) -> usize {
    usize::from(size)
}

// Every edit replaces one whole whitespace token, so edits never overlap.
fn apply(
    source: &str,
    mut edits: Vec<Edit>,
) -> String {
    edits.sort_by_key(|edit| std::cmp::Reverse(edit.start));
    edits.dedup_by_key(|edit| edit.start);

    let mut fixed = source.to_owned();

    for edit in edits {
        fixed.replace_range(edit.start..edit.end, &edit.replacement);
    }

    fixed
}
