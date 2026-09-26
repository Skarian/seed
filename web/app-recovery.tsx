import {Component, type ReactNode} from 'react';
import {reportClientFailure} from './client-failure.js';
import './app-recovery.css';

/** Outside the app's providers/router so a failed screen cannot hide recovery. */
export class AppRecovery extends Component<{children:ReactNode},{failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() {return {failed:true};}
  componentDidCatch(error: unknown) {reportClientFailure(error,'render');}
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-recovery"><section role="alert">
      <span className="app-recovery-brand">Seed</span>
      <h1>This screen couldn’t load</h1>
      <p>Reload to try again. Your saved work is safe, and jobs continue in the background.</p>
      <div className="app-recovery-actions">
        <button type="button" onClick={()=>window.location.reload()}>Reload</button>
        <a href="/">Open Generate</a>
      </div>
    </section></main>;
  }
}
