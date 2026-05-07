import React, { useEffect, useState } from "react";
import { CSSObject, styled, Theme, useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import MuiDrawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import CssBaseline from "@mui/material/CssBaseline";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import SettingsIcon from "@mui/icons-material/Settings";
import InfoIcon from "@mui/icons-material/Info";
import SimParams from "@/app/components/interface/drawer/components/SimParams";
import InfoOverview from "@/app/components/interface/drawer/components/InfoOverview";
import { ClickAwayListener, Slide } from "@mui/material";
import { TransitionGroup } from "react-transition-group";
import DevMetrics from "@/app/components/interface/drawer/components/DevMetrics";

const drawerWidth = 200;

/**
 * Styles for an opened drawer.
 */
const openedMixin = (theme: Theme): CSSObject => ({
  width: drawerWidth,
  transition: theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  overflowX: "hidden",
});

/**
 * Styles for a closed drawer.
 */
const closedMixin = (theme: Theme): CSSObject => ({
  transition: theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  overflowX: "hidden",
  width: `calc(${theme.spacing(7)} + 1px)`,
  [theme.breakpoints.up("sm")]: {
    width: `calc(${theme.spacing(8)} + 1px)`,
  },
});

/** Custom Drawer that can be open or closed with the defined CSS mixins. */
const Drawer = styled(MuiDrawer, {
  shouldForwardProp: (prop) => prop !== "open",
})(({ theme, open }) => ({
  width: drawerWidth,
  flexShrink: 0,
  whiteSpace: "nowrap",
  boxSizing: "border-box",
  ...(open && {
    ...openedMixin(theme),
    "& .MuiDrawer-paper": openedMixin(theme),
  }),
  ...(!open && {
    ...closedMixin(theme),
    "& .MuiDrawer-paper": closedMixin(theme),
  }),
}));

export default function MiniDrawer() {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<
    "simParams" | "infoOverview" | "devMetrics" | null
  >(null);
  const containerRef = React.useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleMouseDown = () => {
      setIsDragging(false);
    };
    const handleMouseMove = () => {
      setIsDragging(true);
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  /** Opens the drawer */
  const handleDrawerOpen = () => {
    setOpen(true);
  };

  /** Closes the drawer */
  const handleDrawerClose = () => {
    setOpen(false);
  };

  /**
   * Clicking a menu item sets which component is selected
   * and ensures the drawer is open.
   */
  const handleComponentSelect = (
    component: "simParams" | "infoOverview" | "devMetrics",
  ) => {
    if (selectedComponent == component) {
      setSelectedComponent(null);
    } else {
      setSelectedComponent(component);
    }
    // setOpen(true); // optional if you want the drawer to open automatically
  };

  /**
   * ClickAwayListener callback.
   * If the drawer is open, close it and reset selected component
   * to ensure that everything is unmounted.
   */
  const handleClickAway = () => {
    if (!isDragging) {
      handleDrawerClose();
      setSelectedComponent(null);
    }
  };

  return (
    <ClickAwayListener onClickAway={handleClickAway}>
      <Box
        component="main"
        sx={{
          width: "100%",
          height: "100%",
          position: "relative",
          zIndex: 2,
        }}
      >
        <CssBaseline />

        {/* The mini-drawer on the left */}
        <Drawer variant="permanent" open={open}>
          <IconButton
            onClick={() => {
              if (open) {
                handleDrawerClose();
              } else {
                handleDrawerOpen();
              }
            }}
          >
            {open ? (
              // If the drawer is open, show ChevronLeft (or ChevronRight in RTL).
              theme.direction === "rtl" ? (
                <ChevronRightIcon />
              ) : (
                <ChevronLeftIcon />
              )
            ) : (
              // Otherwise show the hamburger Menu icon.
              <MenuIcon />
            )}
          </IconButton>

          <Divider />

          <List>
            <ListItem disablePadding>
              <ListItemButton
                selected={selectedComponent === "simParams"}
                onClick={() => handleComponentSelect("simParams")}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 50, // or any smaller value
                  }}
                >
                  <SettingsIcon />
                </ListItemIcon>
                <ListItemText primary="Sim Params" />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                selected={selectedComponent === "infoOverview"}
                onClick={() => handleComponentSelect("infoOverview")}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 50, // or any smaller value
                  }}
                >
                  <InfoIcon />
                </ListItemIcon>
                <ListItemText primary="Info Overview" />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                selected={selectedComponent === "devMetrics"}
                onClick={() => handleComponentSelect("devMetrics")}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 50, // or any smaller value
                  }}
                >
                  <InfoIcon />
                </ListItemIcon>
                <ListItemText primary="Dev Metrics" />
              </ListItemButton>
            </ListItem>
          </List>
        </Drawer>

        {/* Main area for the selected component */}
        <Box
          component="main"
          sx={{
            width: "100%",
            marginLeft: open
              ? `${drawerWidth}px`
              : `calc(${theme.spacing(7)} + 1px)`,
            transition: theme.transitions.create("margin", {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.standard,
            }),
            position: "relative",
          }}
        >
          {/* Animated area for the sub-components */}
          <TransitionGroup>
            {selectedComponent === "simParams" && (
              <Slide
                key="simParams"
                direction="right"
                in={true}
                mountOnEnter
                unmountOnExit
                // eslint-disable-next-line react-hooks/refs -- MUI Slide takes a ref-like container; portal target genuinely is a ref
                container={containerRef.current}
              >
                <Box sx={{ position: "absolute", width: "20%" }}>
                  <SimParams />
                </Box>
              </Slide>
            )}

            {selectedComponent === "infoOverview" && (
              <Slide
                key="infoOverview"
                direction="right"
                in={true}
                mountOnEnter
                unmountOnExit
                // eslint-disable-next-line react-hooks/refs -- MUI Slide takes a ref-like container; portal target genuinely is a ref
                container={containerRef.current}
              >
                <Box sx={{ position: "absolute", width: "30%" }}>
                  <InfoOverview />
                </Box>
              </Slide>
            )}

            {selectedComponent === "devMetrics" && (
              <Slide
                key="devMetrics"
                direction="right"
                in={true}
                mountOnEnter
                unmountOnExit
              >
                <Box sx={{ position: "absolute", width: "20%" }}>
                  <DevMetrics />
                </Box>
              </Slide>
            )}
          </TransitionGroup>
        </Box>
      </Box>
    </ClickAwayListener>
  );
}
