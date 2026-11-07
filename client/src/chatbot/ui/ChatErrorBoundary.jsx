import { Component } from 'react';

// A chatbot bug must never white-screen the app: on any render error the
// widget simply disappears.
export default class ChatErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
