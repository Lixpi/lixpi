package conventions

import (
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"
	"strconv"
	"strings"

	"golang.org/x/tools/go/analysis"
)

func checkErrorMessage(pass *analysis.Pass, call *ast.CallExpr) {
	if len(call.Args) == 0 ||
		!isPackageFunction(pass, call.Fun, "fmt", "Errorf") && !isPackageFunction(pass, call.Fun, "errors", "New") {
		return
	}

	value := pass.TypesInfo.Types[call.Args[0]].Value
	if value == nil || value.Kind() != constant.String {
		return
	}

	redundantText := redundantErrorMessageText(constant.StringVal(value), pass.Pkg.Name())
	if redundantText != "" {
		pass.Reportf(call.Args[0].Pos(), "name the failing step without %s in the error message (error-message-step)", redundantText)
	}
}

func redundantErrorMessageText(message, packageName string) string {
	if strings.HasPrefix(message, packageName+":") {
		return "the package name"
	}

	for segment := range strings.SplitSeq(strings.ToLower(message), ": ") {
		for _, phrase := range []string{"failed", "unable to", "could not", "error"} {
			if segment == phrase || strings.HasPrefix(segment, phrase+" ") {
				return strconv.Quote(phrase)
			}
		}
	}

	return ""
}

func checkErrorTextMatch(pass *analysis.Pass, node ast.Node) {
	var operands []ast.Expr

	switch expression := node.(type) {
	case *ast.CallExpr:
		function := calledFunction(pass, expression.Fun)
		if function == nil || function.Pkg() == nil || function.Pkg().Path() != "strings" {
			return
		}

		switch function.Name() {
		case "Compare", "Contains", "ContainsAny", "Cut", "CutPrefix", "CutSuffix", "EqualFold", "HasPrefix", "HasSuffix", "Index":
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
		if isErrorTextCall(pass, operand) {
			pass.Reportf(operand.Pos(), "match errors with errors.Is or errors.As instead of their message text (error-text-match)")
		}
	}
}

func isErrorTextCall(pass *analysis.Pass, expression ast.Expr) bool {
	if expression == nil {
		return false
	}

	call, ok := ast.Unparen(expression).(*ast.CallExpr)
	if !ok || len(call.Args) != 0 {
		return false
	}

	selector, ok := ast.Unparen(call.Fun).(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != "Error" {
		return false
	}

	selection := pass.TypesInfo.Selections[selector]
	if selection == nil || selection.Kind() != types.MethodVal {
		return false
	}

	errorType, ok := types.Universe.Lookup("error").Type().Underlying().(*types.Interface)

	return ok && types.Implements(selection.Recv(), errorType)
}
