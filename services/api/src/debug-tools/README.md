# API Debug Tools

Files in this directory and its child directories are development-only debug tools.

They are not application runtime code, are not part of supported API behavior, and must not be covered by automated tests. Agents must ignore this directory unless a user explicitly asks to inspect, modify, run, or rely on a file here.

- `inspect-replaced-media-history.ts` compares generated media canvas nodes with generated media nodes stored in AI chat thread documents and checks referenced workspace Object Store objects.
