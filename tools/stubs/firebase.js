// Firebase stub for the engine bundle.
//
// src/lib/utils/character-sheet-helpers.ts imports FieldValue and tests values
// with `instanceof FieldValue` (line ~81), so this must be a real class. Nothing
// else on the engine path touches Firestore; the persistence modules are not
// bundled.
export class FieldValue {}
export class Timestamp {
  constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  toDate() { return new Date(this.seconds * 1000); }
  toMillis() { return this.seconds * 1000; }
  static now() { return new Timestamp(Math.floor(Date.now() / 1000), 0); }
  static fromDate(d) { return new Timestamp(Math.floor(d.getTime() / 1000), 0); }
}
const never = (name) => () => { throw new Error(`firebase.${name} called inside the ShadowBase engine bundle`); };
export const serverTimestamp = () => null;
export const initializeApp = never('initializeApp');
export const getApp = never('getApp');
export const getApps = () => [];
export const getAuth = never('getAuth');
export const getDatabase = never('getDatabase');
export const getFirestore = never('getFirestore');
export const doc = never('doc');
export const getDoc = never('getDoc');
export const setDoc = never('setDoc');
export const collection = never('collection');
export const getDocs = never('getDocs');
export const deleteDoc = never('deleteDoc');
export const query = never('query');
export const where = never('where');
export const orderBy = never('orderBy');
export const limit = never('limit');
export const writeBatch = never('writeBatch');
export const onSnapshot = never('onSnapshot');
export const getCountFromServer = never('getCountFromServer');
export const updateDoc = never('updateDoc');
export const deleteField = () => null;
export const increment = () => 0;
export const arrayUnion = () => null;
export const arrayRemove = () => null;
export default {};
