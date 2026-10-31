// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkablePages, searchPages } from "../src/lib/page-links.ts";

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
