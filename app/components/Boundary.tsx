"use client";
import React from "react";

/**
 * Panel-level error boundary. The detail panels render community-maintained
 * data (OSM and Overture), where a single malformed field can throw. Without
 * this, one bad record white-screens the entire application, which is exactly
 * what a malformed website URL did.
 */
export default class Boundary extends React.Component<
  { children: React.ReactNode; label: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { children: React.ReactNode }) {
    // Reset when the user selects something else, so one bad record does not
    // wedge the panel permanently.
    if (this.state.error && prev.children !== this.props.children) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-[12px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          <div style={{ color: "var(--bad)" }} className="mb-2">
            This {this.props.label} could not be displayed.
          </div>
          <div style={{ color: "var(--ink-3)" }}>
            The underlying record has a malformed field. Everything else on the map
            still works; pick another one.
          </div>
          <div className="mono text-[10px] mt-3" style={{ color: "var(--ink-3)" }}>
            {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
