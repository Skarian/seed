export const credentialDefinitions = [
  { id: 'vastApiKey', name: 'Vast', description: 'Find, rent, and manage GPU workers.', keyUrl: 'https://cloud.vast.ai/manage-keys/' },
  { id: 'runpodApiKey', name: 'RunPod', description: 'Find, rent, and manage GPU workers.', keyUrl: 'https://www.runpod.io/console/user/settings' },
  { id: 'openrouterApiKey', name: 'OpenRouter', description: 'The assistant in Chat.', keyUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'civitaiKey', name: 'Civitai', description: 'Look up adapters and let new workers download them.', keyUrl: 'https://civitai.com/user/account' },
  { id: 'huggingFaceToken', name: 'Hugging Face', description: 'Download model assets that require access to your account.', keyUrl: 'https://huggingface.co/settings/tokens' },
] as const;
export type CredentialField = typeof credentialDefinitions[number]['id'];
export type CredentialStatus = { configured: boolean; validation: 'unchecked' | 'valid' | 'invalid'; checked_at?: string };
export type CredentialStatuses = Record<CredentialField, CredentialStatus>;
export type AdminSettings = { credentials: CredentialStatuses; storage: { config: string; data: string } };
