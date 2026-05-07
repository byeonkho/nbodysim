import { createTheme, ThemeOptions } from "@mui/material/styles";
import "@fontsource/space-grotesk";
import type { CSSProperties } from "react";

// Module augmentation: declare the custom theme additions used below
// (canvas slot, mixins.glass, body3/body6 typography variants) so TS
// knows about them at every consumer site.
declare module "@mui/material/styles" {
  interface Theme {
    canvas: {
      canvasMain: string;
      canvasGradientEdge: string;
    };
  }

  interface ThemeOptions {
    canvas?: {
      canvasMain?: string;
      canvasGradientEdge?: string;
    };
  }

  interface Mixins {
    glass: CSSProperties;
  }

  interface TypographyVariants {
    body3: CSSProperties;
    body6: CSSProperties;
  }

  interface TypographyVariantsOptions {
    body3?: CSSProperties;
    body6?: CSSProperties;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    body3: true;
    body6: true;
  }
}

const themeOptions: ThemeOptions = {
  palette: {
    mode: "dark",
    primary: {
      main: "#0d47a1", // Deep Space Blue
      light: "#5472d3",
      dark: "#002171",
    },
    secondary: {
      main: "#ffab00", // Star Yellow
      light: "#ffdd4b",
      dark: "#c67c00",
    },
    background: {
      default: "#0a1929", // Deeper space blue for default background
      paper: "#1e1e1e", // Slightly lighter than Dark Nebula Gray for contrast
    },
    text: {
      primary: "#ffffff",
      secondary: "#b0bec5",
    },
    error: { main: "#ff1744" },
    warning: { main: "#ff9100" },
    info: { main: "#29b6f6" },
    success: { main: "#00e676" },
  },
  typography: {
    fontFamily: '"Space Grotesk", "Roboto", "Helvetica", "Arial", sans-serif',
    // Standard variants
    h1: {
      fontSize: "3rem",
      fontWeight: 700,
      color: "#ffffff",
      textShadow: "0 0 10px rgba(255,255,255,0.5)",
    },
    h2: {
      fontSize: "1.5rem",
      fontWeight: 700,
      color: "#ffffff",
      textShadow: "0 0 8px rgba(255,255,255,0.4)",
    },
    h3: {
      fontSize: "1rem",
      fontWeight: 700,
      color: "#ffffff",
      textShadow: "0 0 8px rgba(255,255,255,0.4)",
    },
    h4: {
      fontSize: "0.75em",
      fontWeight: 500,
      color: "#ffffff",
      textShadow: "0 0 8px rgba(255,255,255,0.4)",
    },
    subtitle1: {
      fontSize: "1rem",
      color: "#ffffff",
    },
    body1: {
      fontSize: "1rem",
      color: "#ffffff",
    },
    body2: {
      fontSize: "0.875rem",
      color: "#b0bec5",
    },
    // Consider removing or augmenting these custom variants if they are not needed:
    body3: {
      fontSize: "0.75rem",
      color: "#b0bec5",
    },
    body6: {
      fontSize: "0.75rem",
      color: "#ffffff",
    },
  },
  shape: {
    borderRadius: 8,
  },
  canvas: {
    canvasMain: "#00060c",
    canvasGradientEdge: "#00060c",
  },
  mixins: {
    glass: {
      backgroundColor: "rgba(255, 255, 255, 0.05)",
      backdropFilter: "blur(4px)",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      boxShadow: "0px 4px 8px rgba(0, 0, 0, 0.3)",
      borderRadius: 2,
      padding: 2,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#0a1929", // ensure global background color matches your palette
          color: "#ffffff",
          margin: 0,
          padding: 0,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 8,
        },
        containedPrimary: {
          background: "linear-gradient(45deg, #0d47a1 30%, #2196f3 90%)",
          boxShadow: "0 3px 5px 2px rgba(33, 150, 243, .3)",
          "&:hover": {
            background: "linear-gradient(45deg, #002171 30%, #0d47a1 90%)",
          },
        },
        containedSecondary: {
          background: "linear-gradient(45deg, #ffab00 30%, #ffd740 90%)",
          color: "#000000",
          boxShadow: "0 3px 5px 2px rgba(255, 171, 0, .3)",
          "&:hover": {
            background: "linear-gradient(45deg, #c67c00 30%, #ffab00 90%)",
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(13, 71, 161, 0.9)", // Semi-transparent Deep Space Blue
          backdropFilter: "blur(10px)",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(30, 30, 30, 0.8)", // Semi-transparent Dark Nebula Gray
          backdropFilter: "blur(10px)",
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: "rgba(30, 30, 30, 0.9)",
          backdropFilter: "blur(10px)",
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            "& fieldset": {
              borderColor: "rgba(255, 255, 255, 0.23)",
            },
            "&:hover fieldset": {
              borderColor: "rgba(255, 255, 255, 0.5)",
            },
            "&.Mui-focused fieldset": {
              borderColor: "#2196f3",
            },
          },
        },
      },
    },
  },
} as ThemeOptions;

const theme = createTheme(themeOptions);

export default theme;
