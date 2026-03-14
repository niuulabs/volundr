---
hide:
  - navigation
  - toc
---

# OpenAPI Specification

Interactive API documentation generated from the Volundr source code.

<div id="swagger-ui"></div>

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
  SwaggerUIBundle({
    url: '../openapi.json',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis],
    layout: 'BaseLayout',
    deepLinking: true,
    defaultModelsExpandDepth: 1,
    docExpansion: 'list',
    filter: true,
  });
});
</script>

<style>
  /* Match MkDocs Material dark theme */
  .swagger-ui { font-family: var(--md-text-font-family, inherit); }
  .swagger-ui .topbar { display: none; }
  [data-md-color-scheme="slate"] .swagger-ui {
    filter: invert(88%) hue-rotate(180deg);
  }
  [data-md-color-scheme="slate"] .swagger-ui .model-example {
    filter: invert(100%) hue-rotate(180deg);
  }
</style>

!!! info "Download"
    The raw OpenAPI spec is available at [`openapi.json`](../openapi.json).
