package conventions

import (
	"go/ast"
	"go/token"
	"go/types"
	"strings"

	"golang.org/x/tools/go/analysis"
)

func checkProhibitedSymbol(pass *analysis.Pass, identifier *ast.Ident, allowedPanics map[token.Pos]bool) {
	object := pass.TypesInfo.Uses[identifier]

	if builtin, ok := object.(*types.Builtin); ok {
		switch builtin.Name() {
		case "panic":
			if !allowedPanics[identifier.Pos()] {
				pass.Reportf(
					identifier.Pos(),
					"return expected failures; document an unreachable panic with //lixpi:allow-panic and a reason (prohibited-symbol)",
				)
			}
		case "print", "println":
			pass.Reportf(identifier.Pos(), "use log/slog for logging or an explicit writer for command output (prohibited-symbol)")
		}

		return
	}

	function, ok := object.(*types.Func)
	if !ok || function.Pkg() == nil {
		return
	}

	switch function.Pkg().Path() {
	case "fmt":
		switch function.Name() {
		case "Print", "Printf", "Println":
			pass.Reportf(identifier.Pos(), "use log/slog for logging or an explicit writer for command output (prohibited-symbol)")
		}
	case "log":
		switch function.Name() {
		case "Fatal", "Fatalf", "Fatalln", "Panic", "Panicf", "Panicln", "Print", "Printf", "Println":
			pass.Reportf(identifier.Pos(), "use log/slog for structured logging and return failures to the caller (prohibited-symbol)")
		}
	}
}

// panicExceptions binds each directive to a real builtin panic call on the next line.
// A directive cannot suppress another symbol or hide the rest of a function.
func panicExceptions(pass *analysis.Pass, file *ast.File) map[token.Pos]bool {
	panicCalls := map[int]token.Pos{}
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}

		identifier, ok := ast.Unparen(call.Fun).(*ast.Ident)
		if !ok {
			return true
		}

		builtin, ok := pass.TypesInfo.Uses[identifier].(*types.Builtin)
		if ok && builtin.Name() == "panic" {
			panicCalls[pass.Fset.Position(call.Pos()).Line] = identifier.Pos()
		}

		return true
	})

	allowed := map[token.Pos]bool{}

	for _, group := range file.Comments {
		for _, comment := range group.List {
			text := strings.TrimSpace(strings.TrimPrefix(comment.Text, "//"))

			fields := strings.Fields(text)
			if len(fields) == 0 || fields[0] != "lixpi:allow-panic" {
				continue
			}

			if len(fields) == 1 {
				pass.Reportf(comment.Pos(), "lixpi:allow-panic requires a reason (panic-exception)")

				continue
			}

			position, ok := panicCalls[pass.Fset.Position(comment.End()).Line+1]
			if !ok {
				pass.Reportf(comment.Pos(), "lixpi:allow-panic must immediately precede a builtin panic call (panic-exception)")

				continue
			}

			allowed[position] = true
		}
	}

	return allowed
}

func calledFunction(pass *analysis.Pass, expression ast.Expr) *types.Func {
	var identifier *ast.Ident

	switch expression := ast.Unparen(expression).(type) {
	case *ast.Ident:
		identifier = expression
	case *ast.SelectorExpr:
		identifier = expression.Sel
	default:
		return nil
	}

	function, _ := pass.TypesInfo.Uses[identifier].(*types.Func)

	return function
}

func isPackageFunction(pass *analysis.Pass, expression ast.Expr, packagePath, name string) bool {
	function := calledFunction(pass, expression)
	if function == nil || function.Pkg() == nil || function.Pkg().Path() != packagePath || function.Name() != name {
		return false
	}

	signature, ok := function.Type().(*types.Signature)

	return ok && signature.Recv() == nil
}
