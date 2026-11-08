use super::{
    check,
    line_column,
};

fn rules(source: &str) -> Vec<&'static str> {
    match check(source) {
        Ok(report) => report.diagnostics.iter().map(|diagnostic| diagnostic.rule).collect(),
        Err(error) => panic!("fixture does not parse: {error}"),
    }
}

fn fixed(source: &str) -> String {
    match check(source) {
        Ok(report) => report.fixed,
        Err(error) => panic!("fixture does not parse: {error}"),
    }
}

fn assert_clean(source: &str) {
    assert_eq!(rules(source), Vec::<&str>::new(), "{source}");
}

// Applying the fixes must leave nothing fixable behind, or `fix` would
// change the file again on its next run.
fn assert_fix(
    source: &str,
    expected: &str,
) {
    let result = fixed(source);

    assert_eq!(result, expected);
    assert_eq!(fixed(&result), result, "the fix is not idempotent");
}

#[test]
fn block_comments_are_reported_without_a_fix() {
    let source = "/* file */\n/** item */\nfn main() {\n    /*! inner */\n    // line\n}\n";
    let report = check(source).unwrap_or_else(|error| panic!("{error}"));

    assert_eq!(report.diagnostics.len(), 3);
    assert!(
        report
            .diagnostics
            .iter()
            .all(|diagnostic| diagnostic.rule == "no-block-comments" && !diagnostic.fixable)
    );
    assert_eq!(report.fixed, source);
}

#[test]
fn line_and_doc_comments_are_allowed() {
    assert_clean("//! Module docs.\n\n/// Item docs.\n// Note.\nfn main() {}\n");
}

#[test]
fn block_statements_are_separated_from_their_siblings() {
    assert_fix(
        "fn main() {\n    let a = 1;\n    if b() {\n        c();\n    }\n    d(a);\n}\n",
        "fn main() {\n    let a = 1;\n\n    if b() {\n        c();\n    }\n\n    d(a);\n}\n",
    );
}

#[test]
fn every_block_kind_counts() {
    for statement in [
        "match a { _ => {} }",
        "loop { break; }",
        "while a() {}",
        "for _ in a() {}",
        "{ a(); }",
        "unsafe { a() };",
        "fn inner() {}",
        "let Some(a) = b() else { return; };",
    ] {
        let source = format!("fn main() {{\n    first();\n    {statement}\n    last();\n}}\n");

        assert_eq!(rules(&source), ["statement-spacing", "statement-spacing"], "{statement}");
    }
}

#[test]
fn terminal_statements_and_tail_expressions_follow_a_blank_line() {
    assert_fix(
        "fn a() -> u8 {\n    let b = 1;\n    b + 1\n}\n\nfn c() {\n    d();\n    return;\n}\n",
        "fn a() -> u8 {\n    let b = 1;\n\n    b + 1\n}\n\nfn c() {\n    d();\n\n    return;\n}\n",
    );
}

#[test]
fn nothing_is_inserted_before_the_first_or_after_the_last_statement() {
    assert_clean("fn a() -> u8 {\n    if b() {\n        return 1;\n    }\n\n    2\n}\n");
    assert_clean("fn a() {\n    b();\n    c();\n}\n");
    assert_clean("fn a() -> u8 {\n    1\n}\n");
}

#[test]
fn a_validation_if_stays_attached_to_its_let() {
    assert_fix(
        "fn main() {\n    let value = read();\n\n    if value.is_err() {\n        return;\n    }\n}\n",
        "fn main() {\n    let value = read();\n    if value.is_err() {\n        return;\n    }\n}\n",
    );
    assert_clean("fn main() {\n    let (left, right) = read();\n    if let Some(x) = right {\n        use_it(x, left);\n    }\n}\n");
}

#[test]
fn an_if_that_ignores_the_let_is_a_block_statement() {
    assert_eq!(
        rules("fn main() {\n    let value = read();\n    if other() {\n        use_it(value);\n    }\n}\n"),
        ["statement-spacing"],
    );
}

#[test]
fn a_comment_between_statements_keeps_the_blank_line_rule_satisfied() {
    assert_clean("fn main() {\n    a();\n\n    // Explains the loop.\n    loop {\n        break;\n    }\n}\n");
}

#[test]
fn match_arms_stay_on_adjacent_lines() {
    assert_fix(
        "fn main() {\n    match a {\n        1 => b(),\n\n        _ => c(),\n    }\n}\n",
        "fn main() {\n    match a {\n        1 => b(),\n        _ => c(),\n    }\n}\n",
    );
}

#[test]
fn statements_on_one_line_are_reported_without_a_fix() {
    let report = check("fn main() { a(); if b() {} }\n").unwrap_or_else(|error| panic!("{error}"));

    assert_eq!(report.diagnostics.len(), 1);
    assert!(!report.diagnostics[0].fixable);
}

#[test]
fn unparsable_source_is_an_error() {
    assert!(check("fn main( {").is_err());
}

#[test]
fn positions_are_one_based_lines_and_character_columns() {
    assert_eq!(line_column("ab\ncé d", 7), (2, 4));
    assert_eq!(line_column("a", 0), (1, 1));
}
