package main

import (
	"golang.org/x/tools/go/analysis/unitchecker"

	"github.com/lixpi/lixpi/dev-tools/code-quality/go-quality-runner/internal/conventions"
)

func main() {
	unitchecker.Main(conventions.New())
}
