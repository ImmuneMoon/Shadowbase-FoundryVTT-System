// react-hook-form stub for the engine bundle.
//
// The per-item calculation hooks (use-blaster-calculations.ts and friends) import
// useFormContext/useWatch beside the pure functions they export. Foundry only calls
// the pure functions; the hooks themselves must never run here.
const never = (name) => () => { throw new Error(`react-hook-form.${name} called inside the ShadowBase engine bundle`); };
export const useFormContext = never('useFormContext');
export const useWatch = never('useWatch');
export const useForm = never('useForm');
export const useFieldArray = never('useFieldArray');
export const Controller = () => null;
export const FormProvider = () => null;
export default {};
