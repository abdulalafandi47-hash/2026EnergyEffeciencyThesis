import type { MaterialRecord } from './types';

/** Shown for EVERY material: this application has not confirmed any value as an approved Cypriot design value. */
export const NOT_APPROVED_NOTICE =
  'This application has not confirmed this value as an approved Cypriot design value.';

/**
 * Plain-language caveats about one material, for display next to it. They
 * state what kind of number it is and what it must not be used for, following
 * the project's data policy:
 *  - measured, declared and design values are different things;
 *  - supplementary reference tables are not automatically the governing source;
 *  - nothing is presented as an approved Cypriot design value unless that has
 *    been confirmed (it has not, for any record, so far).
 */
export function materialNotices(material: MaterialRecord): string[] {
  const notices: string[] = [];

  switch (material.status) {
    case 'verified':
      notices.push('Verified: the numbers were checked against the cited source (see source details).');
      break;
    case 'unverified':
      notices.push('Unverified: believed to match its cited source but not yet checked against it.');
      break;
    case 'illustrative':
      notices.push('Illustrative: a demonstration value with no source. Not for design or compliance.');
      break;
    case 'user-defined':
      notices.push('User-defined: entered by the user and not checked by this application.');
      break;
  }

  switch (material.valueType) {
    case 'measured':
      notices.push('Measured value: applies to the tested specimen and conditions; it is not automatically a design value.');
      break;
    case 'declared':
      notices.push('Declared (manufacturer) value: applies to the declaration\'s reference conditions; it is not automatically a design value.');
      break;
    case 'design':
      notices.push('Design value as stated by its source: confirm it is the value your assessment prescribes.');
      break;
    case 'unspecified':
      notices.push('It is not stated whether this is a measured, declared or design value.');
      break;
  }

  if (material.source.type === 'reference-table') {
    notices.push('Source is a supplementary reference table: not automatically the governing source for Cypriot design values.');
  }

  notices.push(NOT_APPROVED_NOTICE);
  return notices;
}
