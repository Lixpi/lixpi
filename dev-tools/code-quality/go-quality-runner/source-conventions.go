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

	issues := reportBlockComments(file, fileSet)

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
