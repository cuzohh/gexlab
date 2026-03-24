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
      message: error.message || 'Unknown frontend error',
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
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0d1117',
          color: '#ededf0',
          padding: '2rem',
          fontFamily: 'Inter, sans-serif',
        }}>
          <div style={{
            width: 'min(640px, 100%)',
            background: 'rgba(17, 24, 39, 0.92)',
            border: '1px solid rgba(239, 68, 68, 0.28)',
            borderRadius: '18px',
            padding: '1.5rem',
            boxShadow: '0 18px 60px rgba(0, 0, 0, 0.35)',
          }}>
            <div style={{ fontSize: '0.8rem', letterSpacing: '0.08em', color: '#f87171', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
              Frontend Error
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.6rem' }}>
              The desktop UI hit a runtime error.
            </div>
            <div style={{ color: '#9ca3af', lineHeight: 1.6, marginBottom: '1rem' }}>
              {this.state.message}
            </div>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                border: '1px solid rgba(16, 185, 129, 0.3)',
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                borderRadius: '999px',
                padding: '0.55rem 1rem',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
