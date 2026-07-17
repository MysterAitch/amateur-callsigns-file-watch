import * as dotenv from 'dotenv';

// The project's single point of .env loading. Importing this module loads the
// environment once (Node caches the module, so repeated imports do not reload),
// keeping the dotenv configuration in one place rather than repeated at every
// entry point.
//
// quiet:true suppresses dotenv's startup banner, whose tip line is chosen at
// random on each load — otherwise it injects non-deterministic promotional
// noise (and unfamiliar URLs) into build, test and run output. The .env loading
// itself is unchanged.
dotenv.config({ quiet: true });
