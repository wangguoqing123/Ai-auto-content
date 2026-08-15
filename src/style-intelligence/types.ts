import type { CorpusDocument, ProfileType, RightsBasis, RightsStatus } from './schemas.js';

export type { CorpusDocument } from './schemas.js';

export interface CorpusImportSource {
  creator_id: string;
  creator_display_name: string;
  canonical_url: string | null;
  platform_item_id: string;
  published_at: string;
}

export interface CorpusImportRights {
  basis: RightsBasis;
  permission_reference: string;
  confirmed_at: string;
}

export interface CorpusImportModelProcessing {
  allowed: boolean;
  consent_recorded_at: string;
}

export interface CorpusImportOptions {
  corpusRoot: string;
  sourcePath: string;
  profileId: string;
  profileType: ProfileType;
  rightsStatus: RightsStatus;
  platform: string;
  contentType: string;
  source: CorpusImportSource;
  rights: CorpusImportRights;
  modelProcessing: CorpusImportModelProcessing;
  importedAt?: string;
}

export function rightsStatusForDocument(document: CorpusDocument): 'owned_by_user' | 'licensed' | 'public_reference' {
  return document.rights_status;
}
