import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency } from "@transformer";

export const printFunctionIdentifier = GoAST.createIdentifier("Print");

/**
 * ```go
 * func Print[T any](value T) T {
 *     encoder := json.NewEncoder(os.Stdout)
 *     encoder.SetEscapeHTML(false)
 *     encoder.SetIndent("", "  ")
 *     encoder.Encode(value)
 *     return value
 * }
 * ```
 * Comme `DCommon.print`, la valeur est affichée puis retournée.
 * Le rendu est JSON (tags `json` des variantes Either) et non `util.inspect` de Node.
 */
export const printDependency = DCommon.memo(() => {
	const generic = GoAST.createIdentifier("T");
	const value = GoAST.createIdentifier("value");
	const encoder = GoAST.createIdentifier("encoder");

	const callEncoder = (method: string, argumentsList: readonly GoAST.Expression[]) => GoAST.createCallExpression({
		callee: GoAST.createSelectorExpression({
			target: encoder,
			identifier: GoAST.createIdentifier(method),
		}),
		arguments: argumentsList,
	});

	return createSharedDependency({
		imports: [
			GoAST.createImportDeclaration({ path: "encoding/json" }),
			GoAST.createImportDeclaration({ path: "os" }),
		],
		init: [],
		declarations: [
			GoAST.createFunctionDeclaration({
				identifier: printFunctionIdentifier,
				generic: [
					GoAST.createTypeParameter({
						identifier: generic,
						constraint: GoAST.builtinTypeReferences.any,
					}),
				],
				arguments: [
					GoAST.createFunctionArgument({
						identifier: value,
						type: generic,
					}),
				],
				returnTypes: [generic],
				body: GoAST.createBlockStatement({
					statements: [
						GoAST.createShortVariableDeclarationStatement({
							identifier: encoder,
							initializer: GoAST.createCallExpression({
								callee: GoAST.createSelectorExpression({
									target: GoAST.createIdentifier("json"),
									identifier: GoAST.createIdentifier("NewEncoder"),
								}),
								arguments: [
									GoAST.createSelectorExpression({
										target: GoAST.createIdentifier("os"),
										identifier: GoAST.createIdentifier("Stdout"),
									}),
								],
							}),
						}),
						callEncoder("SetEscapeHTML", [GoAST.createBooleanLiteral({ value: false })]),
						callEncoder("SetIndent", [
							GoAST.createStringLiteral({ value: "" }),
							GoAST.createStringLiteral({ value: "  " }),
						]),
						callEncoder("Encode", [value]),
						GoAST.createReturnStatement({ values: [value] }),
					],
				}),
			}),
		],
	});
});
