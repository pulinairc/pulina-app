// Bundled into ui/vendor/zxcvbn.js: zxcvbn-ts with English and Finnish words.
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';
import * as fi from '@zxcvbn-ts/language-fi';

const each = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));

/** An estimator whose warnings and time words go through `translate`, the app's own t(). */
export function estimator(translate) {
  const base = en.translations;
  return new ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...en.dictionary, ...fi.dictionary },
    graphs: common.adjacencyGraphs,
    translations: { ...base, warnings: each(base.warnings, translate), timeEstimation: each(base.timeEstimation, translate) },
  });
}
