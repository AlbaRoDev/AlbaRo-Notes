// Preloaded by `npm test`: the texts the tests expect are Spanish whatever the language of the machine running them.
globalThis.localStorage = { getItem: (key) => (key === "lang" ? "es" : null), setItem() {} };
