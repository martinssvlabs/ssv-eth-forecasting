import { EstimatorForm } from '@/components/EstimatorForm';
import { ThemeToggle } from '@/components/ThemeToggle';
import { publicForecastDefaults } from '@/lib/forecast-config';
import styles from './page.module.css';

export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlow} aria-hidden="true" />
      <div className={styles.backgroundGlowSecondary} aria-hidden="true" />

      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.metaRow}>
            <div className={styles.metaRowLeft}>
              <p className={styles.kicker}>SSV Mainnet Forecast Tool</p>
              <span className={styles.metaPill}>Forecast Only</span>
            </div>
            <ThemeToggle />
          </div>

          <h1>ETH Deposit Estimator for Cluster Migration</h1>
          <p className={styles.headerLead}>
            Informational estimator only. No wallet connection and no transaction
            execution. Uses live mainnet cluster/operator state plus configured
            ETH-era assumptions.
          </p>
        </header>

        <EstimatorForm defaults={publicForecastDefaults} />
      </div>
    </main>
  );
}
