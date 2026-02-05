# tree-diff examples

Run from the repo root:

```sh
node ./examples/basic.ts
node ./examples/wire-format.ts
node ./examples/strict-preconditions.ts
```

Note: these scripts import from `../src/index.ts` so they run without building. In your app you would typically:

```ts
import { apply, diff } from "@azuliani/tree-diff";
```
