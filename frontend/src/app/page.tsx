// redux only supports CSR
"use client";

import React from "react";
import { store } from "@/app/store/Store";
import { Provider } from "react-redux";
import Layout from "@/app/components/scene/Layout";
import ErrorToast from "@/app/components/interface/misc/ErrorToast";
import { ThemeProvider } from "@mui/system";
import theme from "@/muiTheme";

export default function App() {
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <Layout />
        <ErrorToast />
      </ThemeProvider>
    </Provider>
  );
}
