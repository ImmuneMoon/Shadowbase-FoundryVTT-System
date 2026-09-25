// React stub for the engine bundle.
//
// The website's engine (getCalculatedStats and the per-item derivations) is pure,
// but the modules that export it also import React for the hooks that wrap it.
// Foundry has no React, so those imports resolve here. Hooks run their callbacks
// immediately; nothing renders. If a bundled code path ever needs a real React
// feature, the bundle is pulling in UI it should not - fix the entry, not this file.
export const useMemo = (f) => f();
export const useCallback = (f) => f;
export const useEffect = () => {};
export const useLayoutEffect = () => {};
export const useState = (v) => [typeof v === 'function' ? v() : v, () => {}];
export const useRef = (v) => ({ current: v });
export const useReducer = (r, v) => [v, () => {}];
export const createContext = (v) => ({ Provider: null, Consumer: null, _v: v });
export const useContext = (c) => c && c._v;
export const forwardRef = (f) => f;
export const memo = (f) => f;
export const Fragment = 'Fragment';
export const createElement = () => null;
export const isValidElement = () => false;
export const jsx = () => null;
export const jsxs = () => null;
export const jsxDEV = () => null;
const React = {
  useMemo, useCallback, useEffect, useLayoutEffect, useState, useRef, useReducer,
  createContext, useContext, forwardRef, memo, Fragment, createElement, isValidElement,
};
export default React;
