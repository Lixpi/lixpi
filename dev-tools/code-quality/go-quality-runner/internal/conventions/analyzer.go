// Package conventions checks Lixpi-specific Go rules using resolved symbols and types.
package conventions

import (
	"go/ast"
	"strings"

	"golang.org/x/tools/go/analysis"
)

// New constructs the analyzer without shared mutable state.
func New() *analysis.Analyzer {
	return &analysis.Analyzer{
		Name: "lixpi",
		Doc:  "check prohibited Go symbols, error messages, and error text comparisons",
		Run:  run,
	}
}

func run(pass *analysis.Pass) (any, error) {
	for _, file := range pass.Files {
		if ast.IsGenerated(file) {
			continue
		}

		allowedPanics := panicExceptions(pass, file)
		isTest := strings.HasSuffix(pass.Fset.Position(file.Pos()).Filename, "_test.go")

		ast.Inspect(file, func(node ast.Node) bool {
			switch node := node.(type) {
			case *ast.Ident:
				checkProhibitedSymbol(pass, node, allowedPanics)
			case *ast.CallExpr:
				checkErrorMessage(pass, node)
			}

			// Exact response wording may be part of a test's contract.
			if !isTest {
				checkErrorTextMatch(pass, node)
			}

			return true
		})
	}

	return nil, nil
}
