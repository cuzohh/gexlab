import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected app error occurred.',
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('GEXLAB frontend crashed', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-shell">
          <div className="error-boundary-panel">
            <div className="error-boundary-kicker">App Error</div>
            <div className="error-boundary-title">The app ran into a problem and needs a refresh.</div>
            <div className="error-boundary-copy">{this.state.message}</div>
            <button
              type="button"
              onClick={this.handleReload}
              className="secondary-button"
            >
              Refresh app
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
