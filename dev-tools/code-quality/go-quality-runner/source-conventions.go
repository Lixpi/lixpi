package main

import (
	"bytes"
	"cmp"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

type sourceEdit struct {
	start       int
	end         int
	replacement []byte
	position    token.Position
}

func main() {
	fix := false

	roots := os.Args[1:]
	if len(roots) > 0 && roots[0] == "--fix" {
		fix = true
		roots = roots[1:]
	}

	if len(roots) == 0 {
		roots = []string{"."}
	}

	issues := 0
	failed := false

	for _, root := range roots {
		if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return fmt.Errorf("walk Go source at %q: %w", path, walkErr)
			}

			if entry.IsDir() || filepath.Ext(path) != ".go" {
				return nil
			}

			fileIssues, err := checkFile(path, fix)
			issues += fileIssues

			if err != nil {
				return fmt.Errorf("check Go source file %q: %w", path, err)
			}

			return nil
		}); err != nil {
			fmt.Fprintf(os.Stderr, "check Go source root %q: %v\n", root, err)
			failed = true
		}
	}

	if failed {
		os.Exit(2)
	}

	if issues > 0 {
		os.Exit(1)
	}
}

func checkFile(path string, fix bool) (int, error) {
	source, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("read source: %w", err)
	}

	fileSet := token.NewFileSet()

	file, err := parser.ParseFile(fileSet, path, source, parser.ParseComments)
	if err != nil {
		return 0, fmt.Errorf("parse source: %w", err)
	}

	issues := reportBlockComments(file, fileSet) + reportErrorMessages(file, fileSet)

	// Tests may assert the exact message a caller or operator will read.
	if !strings.HasSuffix(path, "_test.go") {
		issues += reportErrorTextMatches(file, fileSet)
	}

	edits := validationIfSpacingEdits(file, fileSet, source)

	if len(edits) == 0 {
		return issues, nil
	}

	if !fix {
		for _, edit := range edits {
			fmt.Fprintf(
				os.Stderr,
				"%s:%d:%d: keep a validation if attached to its assignment (validation-if-spacing)\n",
				edit.position.Filename,
				edit.position.Line,
				edit.position.Column,
			)
		}

		return issues + len(edits), nil
	}

	slices.SortFunc(edits, func(left, right sourceEdit) int {
		return cmp.Compare(right.start, left.start)
	})

	for _, edit := range edits {
		source = slices.Concat(
			source[:edit.start],
			edit.replacement,
			source[edit.end:],
		)
	}

	info, err := os.Stat(path)
	if err != nil {
		return issues, fmt.Errorf("read source permissions: %w", err)
	}

	if err := os.WriteFile(path, source, info.Mode().Perm()); err != nil {
		return issues, fmt.Errorf("write fixed source: %w", err)
	}

	return issues, nil
}

func reportBlockComments(file *ast.File, fileSet *token.FileSet) int {
	issues := 0

	for _, group := range file.Comments {
		for _, comment := range group.List {
			if !strings.HasPrefix(comment.Text, "/*") {
				continue
			}

			position := fileSet.Position(comment.Pos())
			fmt.Fprintf(
				os.Stderr,
				"%s:%d:%d: use // comments instead of block comments (no-block-comments)\n",
				position.Filename,
				position.Line,
				position.Column,
			)
			issues++
		}
	}

	return issues
}

func reportErrorMessages(file *ast.File, fileSet *token.FileSet) int {
	issues := 0

	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) == 0 || !isPackageCall(call, "fmt", "Errorf") && !isPackageCall(call, "errors", "New") {
			return true
		}

		literal, ok := call.Args[0].(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}

		message, err := strconv.Unquote(literal.Value)
		if err != nil {
			return true
		}

		redundantText := redundantErrorMessageText(message, file.Name.Name)
		if redundantText == "" {
			return true
		}

		position := fileSet.Position(literal.Pos())
		fmt.Fprintf(
			os.Stderr,
			"%s:%d:%d: name the failing step without %s in the error message (error-message-step)\n",
			position.Filename,
			position.Line,
			position.Column,
			redundantText,
		)
		issues++

		return true
	})

	return issues
}

func redundantErrorMessageText(message, packageName string) string {
	if strings.HasPrefix(message, packageName+":") {
		return "the package name"
	}

	for segment := range strings.SplitSeq(strings.ToLower(message), ": ") {
		for _, phrase := range []string{"failed", "unable to", "could not"} {
			if strings.HasPrefix(segment, phrase) {
				return strconv.Quote(phrase)
			}
		}

		if segment == "error" || strings.HasPrefix(segment, "error ") {
			return strconv.Quote("error")
		}
	}

	return ""
}

func reportErrorTextMatches(file *ast.File, fileSet *token.FileSet) int {
	issues := 0
	textMatchers := []string{"Compare", "Contains", "ContainsAny", "Cut", "CutPrefix", "CutSuffix", "EqualFold", "HasPrefix", "HasSuffix", "Index"}

	ast.Inspect(file, func(node ast.Node) bool {
		var operands []ast.Expr

		switch expression := node.(type) {
		case *ast.CallExpr:
			if slices.ContainsFunc(textMatchers, func(name string) bool { return isPackageCall(expression, "strings", name) }) {
				operands = expression.Args
			}
		case *ast.BinaryExpr:
			if expression.Op == token.EQL || expression.Op == token.NEQ {
				operands = []ast.Expr{expression.X, expression.Y}
			}
		case *ast.SwitchStmt:
			operands = []ast.Expr{expression.Tag}
		}

		for _, operand := range operands {
			if !isErrorTextCall(operand) {
				continue
			}

			position := fileSet.Position(operand.Pos())
			fmt.Fprintf(
				os.Stderr,
				"%s:%d:%d: match errors with errors.Is or errors.As instead of their message text (error-text-match)\n",
				position.Filename,
				position.Line,
				position.Column,
			)
			issues++
		}

		return true
	})

	return issues
}

func isPackageCall(call *ast.CallExpr, packageName, functionName string) bool {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != functionName {
		return false
	}

	identifier, ok := selector.X.(*ast.Ident)

	return ok && identifier.Name == packageName
}

func isErrorTextCall(expression ast.Expr) bool {
	call, ok := expression.(*ast.CallExpr)
	if !ok || len(call.Args) > 0 {
		return false
	}

	selector, ok := call.Fun.(*ast.SelectorExpr)

	return ok && selector.Sel.Name == "Error"
}

func validationIfSpacingEdits(file *ast.File, fileSet *token.FileSet, source []byte) []sourceEdit {
	edits := []sourceEdit{}
	checkStatements := func(statements []ast.Stmt) {
		for index := 1; index < len(statements); index++ {
			assignment, assignmentOK := statements[index-1].(*ast.AssignStmt)
			condition, conditionOK := statements[index].(*ast.IfStmt)

			if !assignmentOK || !conditionOK || !conditionUsesAssignedName(condition.Cond, assignment) {
				continue
			}

			assignmentEnd := fileSet.Position(assignment.End()).Offset
			conditionStart := fileSet.Position(condition.Pos()).Offset
			gap := source[assignmentEnd:conditionStart]

			if bytes.Count(gap, []byte{'\n'}) < 2 || len(bytes.TrimSpace(gap)) > 0 {
				continue
			}

			lineStart := bytes.LastIndex(source[:conditionStart], []byte{'\n'}) + 1
			indentation := source[lineStart:conditionStart]
			edits = append(edits, sourceEdit{
				start:       assignmentEnd,
				end:         conditionStart,
				replacement: slices.Concat([]byte{'\n'}, indentation),
				position:    fileSet.Position(condition.Pos()),
			})
		}
	}

	ast.Inspect(file, func(node ast.Node) bool {
		switch statementList := node.(type) {
		case *ast.BlockStmt:
			checkStatements(statementList.List)
		case *ast.CaseClause:
			checkStatements(statementList.Body)
		case *ast.CommClause:
			checkStatements(statementList.Body)
		}

		return true
	})

	return edits
}

func conditionUsesAssignedName(condition ast.Expr, assignment *ast.AssignStmt) bool {
	assignedNames := map[string]struct{}{}

	for _, expression := range assignment.Lhs {
		identifier, ok := expression.(*ast.Ident)

		if ok && identifier.Name != "_" {
			assignedNames[identifier.Name] = struct{}{}
		}
	}

	usesAssignedName := false
	ast.Inspect(condition, func(node ast.Node) bool {
		identifier, ok := node.(*ast.Ident)

		if !ok {
			return true
		}

		if _, ok := assignedNames[identifier.Name]; ok {
			usesAssignedName = true

			return false
		}

		return true
	})

	return usesAssignedName
}
