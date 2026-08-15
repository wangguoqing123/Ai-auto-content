import { defaultStyleCorpusRoot, inspectStyleCorpus } from '../src/style-intelligence/corpus.js';
import { argument } from './style-cli-args.js';

console.log(JSON.stringify(await inspectStyleCorpus(argument('corpus-root') ?? defaultStyleCorpusRoot()), null, 2));
