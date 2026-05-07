"use client";

import { Alert, Snackbar } from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/app/store/Store";
import { clearErrorMessage } from "@/app/store/slices/RequestSlice";

const ErrorToast: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const errorMessage = useSelector(
    (state: RootState) => state.request.errorMessage,
  );

  return (
    <Snackbar
      open={errorMessage !== null}
      autoHideDuration={6000}
      onClose={() => dispatch(clearErrorMessage())}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      <Alert
        severity="error"
        variant="filled"
        onClose={() => dispatch(clearErrorMessage())}
        sx={{ minWidth: 300 }}
      >
        {errorMessage}
      </Alert>
    </Snackbar>
  );
};

export default ErrorToast;
