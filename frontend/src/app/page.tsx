// redux only supports CSR
"use client";

import React from "react";
import { store } from "@/app/store/Store";
import { Provider } from "react-redux";
import Layout from "@/app/components/scene/Layout";
import ErrorToast from "@/app/components/interface/misc/ErrorToast";
import DriftFetchNotice from "@/app/components/interface/misc/DriftFetchNotice";
import { PrefsHydrator } from "@/app/components/PrefsHydrator";

export default function App() {
  return (
    <Provider store={store}>
      <PrefsHydrator />
      <Layout />
      <ErrorToast />
      <DriftFetchNotice />
    </Provider>
  );
}
