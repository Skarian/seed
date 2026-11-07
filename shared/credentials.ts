export const credentialDefinitions = [
  { id: 'vastApiKey', name: 'Vast', description: 'Rent cloud GPUs from Vast.', keyUrl: 'https://cloud.vast.ai/manage-keys/' },
  { id: 'runpodApiKey', name: 'RunPod', description: 'Rent cloud GPUs from RunPod.', keyUrl: 'https://www.runpod.io/console/user/settings' },
  { id: 'openrouterApiKey', name: 'OpenRouter', description: 'Powers Seed’s replies and planning.', keyUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'civitaiKey', name: 'Civitai', description: 'Find styles and download them to your GPUs.', keyUrl: 'https://civitai.com/user/account' },
  { id: 'huggingFaceToken', name: 'Hugging Face', description: 'Downloads models that need your Hugging Face account.', keyUrl: 'https://huggingface.co/settings/tokens' },
] as const;
export type CredentialField = typeof credentialDefinitions[number]['id'];
export type CredentialStatus = { configured: boolean; validation: 'unchecked' | 'valid' | 'invalid'; checked_at?: string };
export type CredentialStatuses = Record<CredentialField, CredentialStatus>;
export type AdminSettings = { credentials: CredentialStatuses; storage: { config: string; data: string } };
