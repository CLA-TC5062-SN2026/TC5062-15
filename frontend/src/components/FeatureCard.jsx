import Card from "./Card.jsx";
import styles from "./FeatureCard.module.css";

export default function FeatureCard({ id, number, title, description, status = "Por implementar" }) {
  return (
    <Card id={id} className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.number}>{number}</span>
        <span className={styles.badge}>{status}</span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
    </Card>
  );
}
