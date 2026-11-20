# Hackathon DuploJS — rendu d’équipe

## Membres de l’équipe

| | Nom | Prénom | Classe |
|---|---|---|---|
| 1 | Nasraoui | Aziz | 5IWJ |
| 2 | Vanderlynden | Louis-Martin | 5IWJ |
| 3 | Ratiaray | Lucas | 5IWJ |

## Objectif

Étudier s’il est possible de transpiler du DuploJS vers Go pour obtenir un programme performant tout en conservant le comportement d’origine. Les dix exercices se trouvent dans `projects/01` à `projects/10`. Le projet `projects/00` présente une solution et sert de point de départ.

## Démarche

1. **Un skill d’équipe** ([`.agents/skills/duplojs-go-strategies/SKILL.md`](.agents/skills/duplojs-go-strategies/SKILL.md)) rassemble nos règles de traduction. Chaque règle est marquée *Proposé* ou *Décidé* et porte sa justification. Il complète les skills fournis (`typescript-to-go`, `go-ast`, `go-printer`), qui décrivent l’architecture du transpileur. Le skill est mis à jour à chaque décision, avant le code.
2. **Pour chaque exercice** : lire la problématique, exécuter la référence Node (`tsx`), analyser les variations de chaque construction, implémenter des transformers génériques (un routeur par domaine DuploJS, un handler par opération), puis comparer la sortie Go à celle de Node.
3. **Le comportement d’abord** : un résultat n’est noté « vérifié » que si le Go compile, passe `go vet` et produit la même sortie que Node. Les observations de performance non mesurées sont signalées comme telles.

## Stratégies transverses

| Construction | Go produit | Justification |
|---|---|---|
| `number` (et littéraux, nombres brandés `number & DNumber.Positive`) | `float64` | IEEE 754 double précision, comme JS. Vérifié : `0.1 + 0.2` donne `0.30000000000000004` des deux côtés. Les contraintes DuploJS n’existent que dans les types. |
| `string` (et littéraux, templates, strings brandés) | `string` | Chaînes immuables des deux côtés. |
| Variante Either (`success`, `fail`, `left`) | un type Go concret par constructeur : `EitherSuccess[T]`, `EitherFail`, `EitherLeft[T]` | Même forme que l’objet JS (marques, information, valeur typée). Tags `json` pour l’affichage. |
| Union de variantes Either | interface `shard_dependencies.Either` (`IsRight()`, `GetInformation()`, `GetValue()`) | Go convertit implicitement une variante vers l’interface, donc chaque `return` compile sans connaître l’union. Le nombre de variantes n’a pas de limite (voir ci-dessous). |
| `isRight(x)` / `matchInformation` | `x.IsRight()` / `switch x.GetInformation()` | Un appel de méthode, un `switch` sur des chaînes : les traductions les plus directes. |
| Ternaire, `&&`, `\|\|` | variable résultat + `if` | Go n’a pas de ternaire. Seule la branche nécessaire est évaluée : le court-circuit de JS est conservé. |
| Fonction fléchée | littéral de fonction Go | Types des paramètres et du retour lus dans le checker TypeScript. |
| `DCommon.print` | `shard_dependencies.Print` | Chaîne affichée brute. Autre valeur affichée en JSON, identique à `JSON.stringify` (le format `util.inspect` de Node n’est pas reproduit). |
| Appel d’une déclaration de fonction | appel direct | Une déclaration est immuable, donc l’ordre d’évaluation est conservé, et Go infère les génériques. Corrige le projet 00 fourni, qui ne compilait pas. |

## Passage à l’échelle des unions

Une fonction DuploJS réelle peut retourner une union de nombreuses variantes, dont les valeurs ont des types différents. Deux représentations ne tiennent pas à l’échelle :

- **une struct générique à deux paramètres** `Either[R, L]` : elle ne peut pas porter plusieurs variantes Left dont les valeurs sont de types différents ;
- **un type Go généré par combinaison d’union** : le nombre de types croît avec chaque union distincte du programme.

Notre représentation évite ces deux écueils. **Toute union de variantes Either, quels que soient son nombre de membres et les types de leurs valeurs, devient la même interface `Either`.** Le nombre de types Go est fixe : un type par constructeur DuploJS. Il ne dépend ni de la taille du programme ni du nombre de combinaisons.

Vérifié : une fonction qui retourne **5 variantes** (`left("too-short", number)`, `left("forbidden-char", string)`, `fail()`, `left("reserved", boolean)`, `success(string)`) est typée `shard_dependencies.Either`. Un `matchInformation` sur les 5 informations, chacune avec son callback typé, donne une sortie Go identique octet pour octet à celle de Node.

Le coût de cette généralité est documenté : chaque conversion vers l’interface peut allouer sur le tas, et `GetValue()` renvoie `any` (boxing puis assertion `.(T)` à l’exécution). L’alternative sans allocation, une struct plate par union, demanderait de calculer chaque union avec le checker et retomberait dans le problème de la génération par combinaison.

**Limite identifiée.** Les unions **mixtes**, où une valeur brute côtoie des variantes Either (par exemple `string | Left<…> | Error<null>`, le résultat de `DEither.unwrapRight`), ne sont pas encore traduites. Le rétrécissement de type qui suit (`if (isLeft(x)) return x;` puis `x` utilisé comme `string`) n’a pas d’équivalent direct en Go, où une variable garde son type statique. Stratégie envisagée : représenter l’union par `any`, puis convertir avec une assertion `x.(T)` à chaque lecture où le checker a rétréci le type.

## Suivi des exercices

| Exercice | Responsable | État | Documentation |
|---|---|---|---|
| 00 (exemple) | Aziz | Correction : le Go fourni ne compilait pas (générique non instancié) | [01/README](projects/01/README.md) |
| 01 — union, `if`, `print` | Aziz | Vérifié, sortie identique à Node | [projects/01](projects/01/README.md) |
| 02 — fonction en argument | Louis | À faire | |
| 03 — `pipe` | Louis | À faire | |
| 04 — `fail`, plusieurs `return` | Aziz | `add.ts` vérifié ; `index.ts` dépend du `pipe` (03) | [projects/04](projects/04/README.md) |
| 05 — `whenIsRightOtherwise`, `map` | Louis | À faire | |
| 06 — `left`, ternaire, `matchInformation` | Aziz | Partie propre vérifiée ; `index.ts` dépend du `pipe` (03, 05) | [projects/06](projects/06/README.md) |
| 07 — `rightPipe` | Louis | À faire | |
| 08 — tuples, déstructuration | Lucas | À faire | |
| 09 — `group` | Lucas | À faire | |
| 10 — asynchronisme | Lucas | À faire | |

Chaque README d’exercice suit la même structure : problématique, solution (Go réellement produit et justification), variations étudiées, résultats observés, limites.

## Performance et mémoire

Rien n’a été mesuré à ce stade. Observations et hypothèses à vérifier (`go build -gcflags=-m`, `go test -bench . -benchmem`) :

- Les variantes Either sont des structs passées par valeur. Les marques (`JSNull`, `JSUndefined`) sont des types de taille nulle et ne coûtent aucun octet.
- La conversion vers l’interface `Either` et `GetValue()` peuvent provoquer des allocations : c’est le compromis assumé pour la généralité.
- Les temporaires `Generated_N` produits par le transpileur sont des variables locales que le compilateur Go élimine ou garde en registre. Hypothèse non vérifiée.

## Reproduction

Prérequis : Node 22, pnpm 12, Go ≥ 1.24 (le `go.mod` généré déclare `go 1.27.4`, que Go télécharge au premier lancement).

```sh
pnpm install
pnpm build:01                          # transpile projects/01 vers projects/01/dist
cd projects/01/dist && go vet ./... && go run .
node_modules/.bin/tsx projects/01/index.ts   # sortie de référence Node
pnpm test:types && pnpm test:lint
```

Scripts disponibles : `build:00`, `build:01`, `build:04`, `build:06`.

Sous Windows, deux contournements **locaux, non versionnés** sont nécessaires :

- Les chemins `DPath` (`/C:/…`) doivent être convertis pour l’API TypeScript (`C:/…`), sinon le build échoue avec `missingProject`.
- `pnpm test:lint` ne fonctionne pas : `tsgolint.js` n’est pas exécutable sous Windows. Lancer le lint sous Linux, macOS ou WSL.

## Rendu

- Faites un fork du boilerplate et ouvrez une pull request vers le dépôt d’origine.
- Remettez une archive ZIP correspondant au travail présenté dans la pull request au moment de la soutenance.
