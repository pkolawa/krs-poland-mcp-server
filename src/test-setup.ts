import { clearKrsCache } from "./utils/api.js";

// The KRS response cache lives for the whole test file; each test mocks fetch on its own.
beforeEach(() => clearKrsCache());
