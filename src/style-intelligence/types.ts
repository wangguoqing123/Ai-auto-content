import type { ProfileType, RightsStatus } from './schemas.js';

export interface CorpusDocument {
  document_id: string;
  profile_id: string;
  profile_type: ProfileType;
  rights_status: RightsStatus;
  platform: string;
  content_type: string;
  title: string;
  source_filename: string;
  imported_at: string;
  text: string;
}

export interface CorpusImportOptions {
  corpusRoot: string;
  sourcePath: string;
  profileId: string;
  profileType: ProfileType;
  rightsStatus: RightsStatus;
  platform: string;
  contentType: string;
  importedAt?: string;
}
