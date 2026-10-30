/// <reference types="vite/client" />

// The library's own module with every icon: importing it (not the package's entry, which the app already imports for
// its own few icons) lets the bundler keep the whole set in a chunk of its own.
declare module "lucide-react/dist/esm/icons/index.mjs";
