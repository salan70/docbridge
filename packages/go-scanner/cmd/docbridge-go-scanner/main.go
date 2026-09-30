// Command docbridge-go-scanner is the DocBridge Go scanner worker. It reads one
// schemaVersion 1 request from stdin and writes the response JSON plus a
// trailing newline to stdout. Stderr carries only error text.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/salan70/docbridge/packages/go-scanner/internal/scanner"
)

func main() {
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "docbridge-go-scanner: failed to read stdin: %v\n", err)
		os.Exit(1)
	}
	output, err := scanner.ScanRequestJSON(input)
	if err != nil {
		fmt.Fprintf(os.Stderr, "docbridge-go-scanner: %v\n", err)
		os.Exit(1)
	}
	if _, err := os.Stdout.Write(append(output, '\n')); err != nil {
		fmt.Fprintf(os.Stderr, "docbridge-go-scanner: failed to write stdout: %v\n", err)
		os.Exit(1)
	}
}
