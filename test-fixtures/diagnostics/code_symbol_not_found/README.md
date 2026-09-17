# code_symbol_not_found

The link manifest declares `src/example.ts#Session.find`. The file is in the
managed code set, but the class member is named `findSession`, so DocBridge
reports `code_symbol_not_found` (error) with a `Did you mean` suggestion.

Run: `just check-fixture code_symbol_not_found`
