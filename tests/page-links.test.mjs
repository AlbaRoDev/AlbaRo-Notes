// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { countBelow, linkablePages, searchPages } from "../src/lib/page-links.ts";

const page = (id, title, extra = {}) => ({
  id,
  title,
  parentId: null,
  databaseId: null,
  kind: "page",
  ownDatabaseId: null,
  role: null,
  favorite: false,
  icon: null,
  cover: null,
  ...extra,
});

const pages = [
  page("tasks", "Tareas", { kind: "database", ownDatabaseId: "db-t", role: "tasks" }),
  page("t1", "Comprar pan", { databaseId: "db-t" }),
  page("other", "Libros", { kind: "database", ownDatabaseId: "db-o" }),
  page("o1", "Dune", { databaseId: "db-o" }),
  page("n1", "Manual de Bash"),
  page("n2", "El manual del mago"),
];

test("the task database and its rows are not offered to link, other databases and their rows are", () => {
  assert.deepEqual(
    linkablePages(pages).map((p) => p.id),
    ["other", "o1", "n1", "n2"],
  );
});

test("search ignores accents and capitals and puts titles that start with the words first", () => {
  assert.deepEqual(
    searchPages(pages, "MÁNUAL").map((p) => p.id),
    ["n1", "n2"],
  );
  assert.deepEqual(searchPages(pages, "tarea"), []);
  assert.equal(searchPages(pages, "", 2).length, 2);
});

test("the pages below one are counted at any depth, the rows of a database included", () => {
  const tree = [
    page("a", "A"),
    page("a1", "A1", { parentId: "a" }),
    page("a2", "A2", { parentId: "a" }),
    page("a1x", "A1x", { parentId: "a1" }),
    page("b", "B"),
  ];
  assert.equal(countBelow(tree, "a"), 3);
  assert.equal(countBelow(tree, "a1"), 1);
  assert.equal(countBelow(tree, "b"), 0);
  assert.equal(
    countBelow(
      [...pages.map((p) => ({ ...p, parentId: p.databaseId === "db-o" ? "other" : null }))],
      "other",
    ),
    1,
  );
});
