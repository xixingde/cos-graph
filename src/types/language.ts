export enum FileType {
  Code = "code",
  Document = "document",
  Paper = "paper",
  Image = "image",
  Video = "video",
}

export interface LanguageConfig {
  tsModule: string;
  tsLanguageFn: string;
  classTypes: string[];
  functionTypes: string[];
  importTypes: string[];
  callTypes: string[];
  commentTypes: string[];
  stringTypes: string[];
  decoratorTypes: string[];
  namespaceTypes: string[];
  staticPropTypes: string[];
  helperFnNames: string[];
  containerBindMethods: string[];
  eventListenerProperties: string[];
  nameField: string;
  nameFallbackChildTypes: string[];
  bodyField: string;
  bodyFallbackChildTypes: string[];
  callFunctionField: string;
  callAccessorNodeTypes: string[];
  callAccessorField: string;
  functionBoundaryTypes: string[];
  functionLabelParens: boolean;
  docLanguage: string;
  chunking: boolean;
  binary: boolean;
}
