---
title: "ContextsEventsRecord"
---

[**@errand/core**](./api-reference.md)

***

[@errand/core](./api-reference.md) / ContextsEventsRecord

# Type Alias: ContextsEventsRecord\<T\>

> **ContextsEventsRecord**\<`T`\> = `{ [K in keyof T]: T[K]["schema"] }`

Defined in: [packages/core/src/types.ts:1043](https://github.com/dojoengine/errand/blob/612e9304717c546d301f9cac8c204de734cac957/packages/core/src/types.ts#L1043)

Maps event definitions to their schema types

## Type Parameters

### T

`T` *extends* `Record`\<`string`, [`EventDef`](./EventDef.md)\>

Record of event definitions
