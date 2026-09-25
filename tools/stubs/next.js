// next/* stub for the engine bundle. Nothing on the engine path should reach it;
// if a build pulls it in, the entry is importing a page or layout component.
export default {};
export const useRouter = () => ({ push() {}, replace() {} });
export const usePathname = () => '';
export const useSearchParams = () => new URLSearchParams();
