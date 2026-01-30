import { PROVIDER_METADATA, DEFAULT_PROVIDER_ID } from '../services/providers';
import type { ProviderId } from '../types/ai';
import type { ProviderMetadata } from '../services/providers/types';

const REQUIRED_FIELDS: Array<keyof ProviderMetadata> = [
    'id',
    'label',
    'description',
    'docsUrl',
    'keyLabel',
    'supportsLiveTranscription',
];

const REQUIRED_PROVIDER_IDS: ProviderId[] = ['gemini', 'openai'];

const assert = (condition: boolean, message: string) => {
    if (!condition) {
        console.error(`❌ ${message}`);
        process.exit(1);
    }
};

const run = () => {
    const metaEntries = Object.entries(PROVIDER_METADATA);
    assert(metaEntries.length > 0, 'No providers registered.');

    REQUIRED_PROVIDER_IDS.forEach(id => {
        assert(PROVIDER_METADATA[id], `Missing provider metadata for "${id}".`);
    });

    assert(
        PROVIDER_METADATA[DEFAULT_PROVIDER_ID as ProviderId] !== undefined,
        `DEFAULT_PROVIDER_ID "${DEFAULT_PROVIDER_ID}" is not present in PROVIDER_METADATA.`
    );

    metaEntries.forEach(([id, meta]) => {
        REQUIRED_FIELDS.forEach(field => {
            assert(
                meta[field] !== undefined && meta[field] !== null,
                `Provider "${id}" is missing required field "${field}".`
            );
        });

        assert(
            meta.supportsLiveTranscription === false,
            `AI providers should not advertise live transcription now that streaming STT is handled separately. Found supportsLiveTranscription=true for "${id}".`
        );
    });

    console.log('✅ Provider metadata verification passed.');
};

run();
