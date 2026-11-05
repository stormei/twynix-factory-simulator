# Engineering rules

- Keep strict TypeScript; do not introduce `any`, browser-owned physics, unsafe expression evaluation, or outbound real-equipment control.
- Backend owns runtime. Equipment physics must remain independent of Angular, storage, and OPC UA.
- Use equipment definitions to generate the library and OPC UA tags. Keep project/equipment IDs stable.
- Validate imported projects and commands at the boundary. Preserve deterministic seeded behavior and fixed 100 ms steps.
- Run `npm run build`, `npm test`, and relevant Playwright checks before delivery. Network integration tests need permission to bind local sockets in restricted environments.
- Update docs when behavior or assumptions change. Do not label unfinished backlog features complete.
- Do not commit .env, data, private keys, node_modules, or generated builds.
