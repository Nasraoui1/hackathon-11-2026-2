---
name: duplojs-go-strategies
description: Règles de l'équipe pour traduire les constructions DuploJS/TypeScript des exercices 01 à 10 en Go performant et fidèle — représentations Go, sémantique à préserver, méthode de travail par exercice, validation et documentation. À utiliser avant de concevoir ou d'implémenter un transformer pour un exercice de `projects/`, et pour rédiger sa documentation.
---

# Stratégies de traduction DuploJS → Go

Ce skill complète `typescript-to-go` (architecture du transpileur : listes, routeurs, handlers, `before`, shared dependencies), `go-ast` et `go-printer`. Il ne répète pas leurs règles : il fixe **quoi** produire en Go et **comment le justifier**. En cas de conflit sur l'architecture, `typescript-to-go` fait foi.

Chaque règle porte un statut :

- **[Décidé]** : choix validé par l'équipe, à appliquer.
- **[Proposé]** : recommandation argumentée, à confirmer en équipe avant de s'en écarter ou de la généraliser.

Quand un choix change, mettre à jour ce fichier avant le code : il sert de mémoire commune à l'équipe et à ses agents.

## 1. Principes directeurs

1. **Le comportement d'abord, mesuré contre Node.** Le programme Go doit produire les mêmes effets observables que `tsx projects/XX/index.ts` : sorties, ordre des effets, valeurs et variantes des résultats. Toute divergence est soit corrigée, soit documentée comme limite.
2. **Typer statiquement plutôt que `any`.** Le checker TypeScript connaît le type de chaque expression : s'en servir pour choisir une représentation Go concrète. `any`/`interface{}` n'est autorisé que si aucun type concret n'existe (union hétérogène ouverte, valeur réellement dynamique) et doit être justifié dans la documentation de l'exercice : il préserve le comportement mais fait perdre le bénéfice recherché (boxing, allocation, assertions à l'exécution).
3. **Valeurs plutôt que pointeurs, pile plutôt que tas.** Préférer les structs passées par valeur, les tableaux de taille fixe, les slices préallouées. Éviter ce qui fait s'échapper une valeur vers le tas (interface, closure capturante, pointeur retourné) sans raison.
4. **Résoudre la composition à la compilation.** Les combinateurs DuploJS (`pipe`, `whenIsRight`, `rightPipe`, `map`…) sont des fonctions d'ordre supérieur en JS. Quand l'appel est statiquement connu, les **déplier** en instructions Go (`if`, `for`, `switch`) plutôt que d'émettre des closures et un runtime générique. Un helper générique en shared dependency n'est utilisé que lorsque le dépliage est impossible ou que la fonction est passée comme valeur.
5. **Générique, pas spécifique à l'exemple.** Un handler traduit une *opération* DuploJS dans toutes ses formes valides (data-first / data-last, fonction en ligne / référence / fonction importée, alias d'import), pas les valeurs de l'exemple. Lister les variations étudiées dans la doc.
6. **Ordre d'évaluation et effets préservés.** Hériter de la règle `before` de `typescript-to-go`, et en plus : ne jamais sortir d'une branche conditionnelle les préparations qui n'appartiennent qu'à elle (voir §4).

## 2. Représentations des types

| TypeScript / DuploJS | Go | Statut | Justification |
|---|---|---|---|
| `number`, littéraux, unions de littéraux, nombre brandé `number & DNumber.Positive` | `float64` | [Décidé] (projet 00, `type/float.ts`) | IEEE 754 double, identique à JS. La contrainte DuploJS n'existe que dans les types. |
| `string` | `string` | [Proposé] | Chaînes immuables des deux côtés. Attention : JS indexe en UTF-16, Go en octets ; ne pas traduire `.length`/indexation sans conversion. |
| `boolean` | `bool` | [Proposé] | — |
| `T[]` | `[]T` | [Proposé] | Slice, préallouée avec `make([]T, n)` quand la taille est connue. |
| Tuple `[A, B, C]` homogène | `[3]T` | [Proposé] | Tableau Go de taille fixe : valeur, cardinalité conservée, pas d'allocation séparée. |
| Tuple hétérogène | struct `{ V0 A; V1 B; … }` | [Proposé] | Position → champ, typage conservé. |
| `null` / `undefined` | `shard_dependencies.JSNull` / `JSUndefined` | [Décidé] (boilerplate) | Types vides de taille nulle. Un champ `undefined` porte le tag `omitzero` : il est omis du JSON comme avec `JSON.stringify` (projet 04, `EitherFail.Value`). |
| Types textuels : `string`, littéral, template, string brandé `string & X`, et leurs unions | `string` | [Décidé] (projet 06, `type/string.ts`) | La marque et le littéral n'existent que dans les types ; TypeScript a déjà vérifié la valeur. |
| `Promise<T>` | voir §6 | [Proposé] | — |

Généricité : une fonction générique Go **doit être instanciée** lorsqu'elle est utilisée comme valeur (`EitherSuccessOf[float64]`). Les arguments de type se lisent dans le checker (type de l'appel / signature résolue), jamais dans le texte source. Le Go actuel du projet 00 ne compile pas pour cette raison (`cannot use generic function … without instantiation`) : à corriger en premier.

## 3. Représentation de l'`Either` — décision centrale

Toutes les autres traductions en dépendent : la fixer avant les exercices 01, 04 et 06.

Faits à respecter, tirés du runtime `@duplojs/lang/dist/either` :

- Une valeur Either est un objet portant `right` **ou** `left`, une `information` (string) et une `value`. `success(v)` ajoute la marque `success` et l'information `"success"` ; `fail()` ajoute la marque `fail`, l'information `"fail"` et une valeur `undefined`. `left(info, v)` et `right(info, v)` sont les formes générales.
- Une fonction peut retourner une **union** de variantes : `Success<number> | Fail`, `Left<"negative-operand", number> | Success<number>`… Le type de retour vient du checker (union inférée si non annotée).

**[Décidé] (projet 01) Interface Go `Either`, une variante = un type concret** (shared dependencies) :

```go
type Either interface { IsRight() bool }
type EitherSuccess[T any] struct { Right JSNull; Information string; Value T; Success JSNull }
func (_ EitherSuccess[T]) IsRight() bool { return true }
```

- Variantes existantes : `EitherSuccess[T]` (`success`), `EitherFail` (`fail`, projet 04), `EitherLeft[T]` (`left(information, value)`, projet 06). Un type Either seul (`Success<T>`, `Fail`) garde son type concret. Une union dont **tous** les membres sont des types Either devient `shard_dependencies.Either` (routeur `duploJSEitherUnionTypeTransformer`).
- Chaque variante est un type **défini** (pas un alias, sinon pas de méthode possible), avec ses tags `json`, et implémente `IsRight()` via `createIsRightMethod` (`either/sharedDependency.ts`).
- L'interface porte trois méthodes, générées pour chaque variante par `createEitherMethods` : `IsRight() bool`, `GetInformation() string`, `GetValue() any` (projet 06).
- `isRight(x)` → `x.IsRight()`. Pour lire la valeur typée d'une union : `x.GetValue().(T)`, où `T` est le type attendu donné par le checker (par exemple le paramètre du callback). Coût : boxing de la valeur et assertion à l'exécution.
- Pourquoi : Go convertit implicitement une variante vers l'interface, donc `return EitherSuccessOf(x)` compile sans connaître l'union. C'est la solution la plus simple.
- Coût accepté et documenté : allocation sur le tas à la conversion vers l'interface, appel dynamique pour `IsRight()`.
- Alternative écartée (optimisation future) : une struct plate `Either[R, L]` sans allocation. Go n'infère pas `L` depuis le type de retour attendu, donc il faudrait calculer `R` et `L` avec le checker et instancier chaque constructeur.
- **Passage à l'échelle** : [Décidé] ne jamais générer un type Go par union, ni une struct à deux paramètres `Either[R, L]`. Toute union Either, quel que soit le nombre de variantes ou de types de valeur, devient la même interface ; un nouveau constructeur DuploJS (`right`, `error`…) = une nouvelle variante via `createEitherMethods`, rien d'autre. Vérifié avec 5 variantes de 4 types de valeur différents.
- **Unions mixtes** (valeur brute + variantes Either, ex. résultat de `unwrapRight`) : non prises en charge. Piste [Proposé] : `any` pour la variable, puis `x.(T)` à chaque lecture où le checker a rétréci le type (`if (isLeft(x)) return x;` puis `x` utilisé comme `string`).

Rendu (`print`) : voir §7.

## 4. Expressions et instructions

- **Appel de fonction** : [Décidé] (projets 00, 01) arguments évalués dans l'ordre et stockés dans des temporaires. La fonction appelée n'est stockée dans un temporaire **que si elle n'est pas une déclaration de fonction** : une déclaration (locale, importée, membre de namespace) est immuable, donc on l'appelle directement, ce qui laisse Go inférer ses génériques.
- **`const x = e`** : [Décidé] (projet 01) `Sourced_x := e`, type inféré par Go. Une seule déclaration, nom simple.
- **`if` / `else`** : [Décidé] (projet 01) condition traduite avec ses `before` placés avant le `if` ; chaque branche est un bloc traduit indépendamment, et une instruction seule est enveloppée dans un bloc avec ses `before`.
- **Ternaire `c ? a : b`** : [Décidé] (projet 06, `expression/conditional.ts`) déclaration du résultat puis `if/else`, et non un helper `ternary(c, a, b)` qui évaluerait les deux branches :
  ```go
  var t T
  if c { /* before de a */ t = a } else { /* before de b */ t = b }
  ```
  Les `before` de `a` et `b` restent **dans** leur branche. Le type `T` vient du checker.
- **`&&` / `||`** : [Décidé] (projet 06, `expression/logical.ts`, placé avant `binary` dans la liste) `t := left; if t { t = right }` (`if !t` pour `||`) : l'opérande droit et ses `before` ne sont évalués que si nécessaire. Le transformer binaire générique évaluait les deux opérandes.
- **Fonction fléchée** : [Décidé] (projet 06, `expression/arrowFunction.ts`) `(p) => e` → `func(p T) R { return e }`. `T` et `R` viennent du checker (le source ne les écrit souvent pas). Pas de déstructuration ni d'`async`.
- **`x as T`, `x satisfies T`, `x!`** : [Décidé] traduction de `x` seul (`expression/typeAssertion.ts`) : aucun effet à l'exécution.
- **Type absent du source** : [Décidé] utiliser `transformCheckerType(type, location, context)` (`type/fromChecker.ts`) : `typeToTypeNode` du checker puis la liste des transformers de types.
- **Plusieurs `return`** : [Décidé] (projet 04) rien de spécifique. Le type de retour (annoté ou inféré) est une union Either, donc l'interface `Either`, et Go convertit implicitement chaque variante retournée. Les `before` d'un `return` restent dans son bloc.
- **Opérateurs préfixes** : [Décidé] (projet 04) `-x`, `+x`, `!x` deviennent l'opérateur Go identique (`-1` est `-` appliqué à `1`). `~x` (int32 en JS), `++x` et `--x` sont refusés.
- **Déstructuration de paramètre `([a, b, c]) => …`** : [Proposé] paramètre Go unique (`[3]float64` ou struct), puis `a := p[0]`… en tête de corps. Si la fonction est dépliée dans une boucle (§5), lier directement depuis l'élément courant.

## 5. Combinateurs DuploJS (dépliage)

Les formes **data-first** `f(input, …)` et **data-last** `f(…)(input)` (curryfiée, utilisée dans `pipe`) doivent être reconnues toutes les deux. Le runtime choisit la forme selon le nombre d'arguments ; le transformer décide de la même façon, d'après la signature résolue par le checker.

| DuploJS | Go déplié [Proposé] |
|---|---|
| `pipe(x, f, g)` | `t1 := f(x); t2 := g(t1)`, chaque étape étant elle-même dépliée si possible. |
| `whenIsRight(e, f)` | `if e.IsRight { out = f(e.Right) } else { out = e }`. Le type de `out` est l'union donnée par le checker. |
| `whenIsRightOtherwise(e, f, g)` | `if e.IsRight { out = f(e.Right) } else { out = g(e) }` |
| `rightPipe(x, f1, f2…)` | Chaîne de `if !acc.IsRight { goto/retour anticipé }`. Une étape qui renvoie une valeur non-Either passe telle quelle, et le résultat final est enveloppé dans `success` (cf. runtime). |
| `matchInformation(e, {k: f})` | [Décidé] (projet 06) entrée et callbacks évalués dans l'ordre, puis `var out T; switch e.GetInformation() { case "k": out = f(e.GetValue().(P)) }` ; l'argument n'est passé que si le callback a un paramètre. |
| `group([e1, e2…])` | Boucle séquentielle qui s'arrête au **premier Left**. Les thunks `() => e` ne sont appelés que si les précédents ont réussi. Valeurs dans une slice préallouée. |
| `DArray.map(xs, f)` | `out := make([]U, len(xs)); for i, x := range xs { out[i] = f(x) }` |
| `DArray.coalescing(v)` | Le type est connu statiquement : `[]T{v}` si `v` n'est pas un tableau, `v` sinon. Pas de test à l'exécution. |
| `DString.to(n)` pour un `number` | [Décidé] (projet 06) `NumberToString(n)` = `strconv.FormatFloat(n, 'f', -1, 64)`. Passé comme valeur → référence à `NumberToString`. Écarts : notation exponentielle de JS (≥ 1e21, < 1e-6), `Infinity`. |

Quand une fonction DuploJS est passée **comme valeur** (par exemple `DString.to` donné à `map`), émettre une référence à un helper Go **instancié** sur le type concret, ou l'inliner dans la boucle si le handler de `map` sait le faire.

## 6. Asynchronisme (projet 10)

Faits du runtime : `rightAsyncPipe` attend chaque étape **dans l'ordre** ; `asyncGroup` appelle les thunks **un par un** et s'arrête au premier Left, sans appeler les suivants ; `asyncPipe` attend chaque étape.

**[Proposé]** Traduire `async`/`await` par une exécution **synchrone** : une fonction `async` qui retourne `Promise<T>` devient une fonction Go qui retourne `T`, et `await e` devient `e`. Justification : l'ordre des effets et l'arrêt au premier échec sont exactement préservés, sans goroutine ni channel. Lancer les calculs de `asyncGroup` en goroutines **changerait le comportement**, puisque des calculs seraient exécutés après un échec. Limites à documenter : une vraie concurrence (I/O, `Promise.all`), un `await` dans une boucle avec des effets entrelacés, l'ordre micro-tâches / macro-tâches et le `await` au top-level à traduire dans `init`/`main`.

## 7. Sortie observable (`DCommon.print`)

`print(x)` appelle `console.info(x)` côté Node : format `util.inspect`, pas du JSON. Pour l'Either, Node affiche les clés `'@duplojs/lang/kind/@DuplojsLangEither/…'`.

**[Décidé] (projets 01, 06)** `shard_dependencies.Print[T](v) T` affiche une chaîne brute (`fmt.Println`, comme `console.info`), et toute autre valeur en JSON indenté (`json.NewEncoder(os.Stdout)`, `SetEscapeHTML(false)`, `SetIndent("", "  ")`) puis la retourne, comme `DCommon.print`. On s'appuie sur les tags `json` des variantes et sur les `MarshalJSON` de `JSNull`/`JSUndefined`, prévus par le boilerplate. On compare donc avec Node **sur la structure** (clés, valeurs, ordre) ; l'écart de format (`util.inspect` contre JSON) est une limite documentée. Reproduire `util.inspect` demanderait un formateur Go complet écrit avec les factories de l'AST, qui n'a pas de nœud « Go brut ».

## 8. Méthode de travail par exercice

1. **Lire** `projects/XX/README.md` (problématique), `index.ts` et les fichiers importés.
2. **Exécuter la référence Node** et garder la sortie :
   `node_modules/.bin/tsx projects/XX/index.ts > projects/XX/expected.txt`
3. **Analyser les variations** de chaque construction (formes d'appel, alias, types, fonction en ligne ou par référence) : la doc doit montrer que la stratégie ne se limite pas à l'exemple.
4. **Prototyper le Go à la main** dans le scratchpad, puis le compiler et l'exécuter. Décider de la forme cible *avant* d'écrire le transformer.
5. **Implémenter** les routeurs et handlers selon `typescript-to-go` : un dossier par opération dans `transformers/duplojs/<domaine>/<opération>/`, avec les shared dependencies memoïsées.
6. **Valider** :
   ```sh
   pnpm build --tsconfig projects/XX/tsconfig.json --input projects/XX/index.ts --output projects/XX/dist
   cd projects/XX/dist && go vet ./... && go run . > ../actual.txt
   diff projects/XX/expected.txt projects/XX/actual.txt
   pnpm test:types && pnpm test:lint
   ```
   Re-builder **tous** les exercices déjà faits après un changement dans un transformer partagé (non-régression).
7. **Observer la performance** quand c'est pertinent : `go build -gcflags=-m` pour les échappements vers le tas, et `go test -bench . -benchmem` sur un prototype. Distinguer ce qui a été mesuré de ce qui est supposé.
8. **Documenter** dans `projects/XX/README.md`, sous la problématique existante (§9).

Ajouter un script `build:XX` dans `package.json` pour chaque exercice traité.

## 9. Gabarit de documentation (README de l'exercice)

Garder la section « Problématique » fournie, puis ajouter :

```markdown
## Solution

### <Problème n>
Go produit (extrait réel de dist/) puis explication : représentation choisie, pourquoi, alternatives écartées et raison.

## Variations étudiées
Formes de l'opération prises en charge / refusées (data-first, data-last, référence, alias…).

## Résultats observés
Sortie Node vs sortie Go (identiques ? écarts ?). Observations mémoire/perf mesurées (commande + chiffres) ou « non mesuré ».

## Limites
Ce qui n'est pas pris en charge, pourquoi, et piste éventuelle.
```

Le README racine résume : membres (noms, prénoms, classes), stratégies transverses (renvoi à ce skill), tableau d'avancement par exercice et étapes de reproduction.

## 10. Environnement (pièges connus)

- **Windows** : le build échoue avec `missingProject`, car les chemins `DPath` sont de la forme `/C:/…` alors que l'API TypeScript attend `C:/…`. Il faut un correctif **local, non versionné** : convertir les chemins à chaque échange avec l'API TypeScript (`createTypescriptInstance.ts`, `build.ts`, `context/file.ts`, `resolvedReference.ts`). Linux et macOS ne sont pas concernés.
- **Lint sous Windows** : `pnpm test:lint` échoue (`tsgolint.js` n'est pas un exécutable Win32, puis le plugin `@stylistic` n'est pas résolu). Lancer le lint sous Linux, macOS ou WSL avant de fusionner.
- **pnpm 12 sous Windows** : si `pnpm` échoue avec « …\node_modules\pnpm\pnpm n'est pas reconnu », les shims `.CMD` de `%LOCALAPPDATA%\pnpm\.tools\pnpm\12.18.0\bin` doivent appeler `node_modules\@pnpm\exe.win32-x64\pnpm.exe`.
- `go.mod` généré déclare `go 1.27.4` : au premier `go run`, Go télécharge cette toolchain (lent la première fois).
