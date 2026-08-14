// Deterministic random hook for the QuickJS conformance driver only.
// Production hosts must provide their own CSPRNG through
// globalThis.__DSH_GET_RANDOM_VALUES before importing the engine bundle.
globalThis.__DSH_CONFORMANCE = true;
let state = 0x6d2b79f5;
globalThis.__DSH_GET_RANDOM_VALUES = (array) => {
for (let i = 0; i < array.length; i++) {
state ^= state << 13;
state ^= state >>> 17;
state ^= state << 5;
array[i] = (state >>> 0) & 0xff;
}
return array;
};
