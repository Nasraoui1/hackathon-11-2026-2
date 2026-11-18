import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency } from "@transformer";

export const eitherTypeIdentifier = GoAST.createIdentifier("Either");
export const isRightMethodIdentifier = GoAST.createIdentifier("IsRight");

/**
 * Union de variantes Either (`Success<T> | Fail | Left<...>`).
 * Chaque variante est un type Go concret qui implémente cette interface :
 * un `return` d'une variante est converti implicitement par Go vers l'union.
 */
export const eitherDependency = DCommon.memo(
	() => createSharedDependency({
		imports: [],
		init: [],
		declarations: [
			GoAST.createTypeDefinition({
				identifier: eitherTypeIdentifier,
				type: GoAST.createInterfaceType({
					elements: [
						GoAST.createInterfaceMethod({
							identifier: isRightMethodIdentifier,
							arguments: [],
							returnTypes: [GoAST.builtinTypeReferences.bool],
						}),
					],
				}),
			}),
		],
	}),
);

/**
 * Méthode `IsRight()` d'une variante : c'est elle qui fait implémenter `Either`.
 */
export function createIsRightMethod(
	receiverType: GoAST.MethodReceiverType,
	isRight: boolean,
) {
	return GoAST.createMethodDeclaration({
		identifier: isRightMethodIdentifier,
		receiver: [GoAST.createIdentifier("_"), receiverType],
		generic: [],
		arguments: [],
		returnTypes: [GoAST.builtinTypeReferences.bool],
		body: GoAST.createBlockStatement({
			statements: [
				GoAST.createReturnStatement({
					values: [GoAST.createBooleanLiteral({ value: isRight })],
				}),
			],
		}),
	});
}
