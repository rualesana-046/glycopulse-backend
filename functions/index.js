const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const twilio = require("twilio");

// Declaración de secretos gestionados por Cloud Secret Manager
const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioPhoneNumber = defineSecret("TWILIO_PHONE_NUMBER");
const emergencyContactNumber = defineSecret("EMERGENCY_CONTACT_NUMBER");

/**
 * Cloud Function v2 que escucha nuevos documentos en 'episodes/{episodeId}'
 * y envía una alerta por SMS al contacto de emergencia usando Twilio.
 */
exports.sendEmergencySms = onDocumentCreated(
  {
    document: "episodes/{episodeId}",
    secrets: [
      twilioAccountSid,
      twilioAuthToken,
      twilioPhoneNumber,
      emergencyContactNumber,
    ],
  },
  async (event) => {
    const episodeId = event.params.episodeId;
    const snapshot = event.data;

    if (!snapshot) {
      logger.warn(`No se encontraron datos en el evento para el episodio: ${episodeId}`);
      return;
    }

    const data = snapshot.data();
    if (!data) {
      logger.warn(`El documento del episodio ${episodeId} no contiene datos.`);
      return;
    }

    // Extracción segura de campos comunes
    const rawRisk = data.riskLevel || data.risk || "";
    const riskLevel = String(rawRisk).toUpperCase().trim();

    // La alerta solo se activa si el nivel de riesgo es ALTO o HIGH
    if (riskLevel !== "ALTO" && riskLevel !== "HIGH") {
      logger.info(`Episodio ${episodeId} omitido: nivel de riesgo (${riskLevel}) no es ALTO ni HIGH.`);
      return;
    }

    const rawSymptoms = data.symptoms || data.symptom || data.description || "";
    const symptoms = Array.isArray(rawSymptoms)
      ? rawSymptoms.join(", ")
      : (typeof rawSymptoms === "string" ? rawSymptoms : String(rawSymptoms || ""));

    const userName = data.userName || data.patientName || data.name || "el usuario";

    // Construcción de texto claro y breve en español
    let messageBody = `Alerta GlycoPulse: Se detecto un posible episodio (Riesgo: ${riskLevel}). Por favor verifica a ${userName}.`;
    if (symptoms) {
      messageBody += ` Sintomas: ${symptoms}.`;
    }

    try {
      // Extracción y sanitización de secretos eliminando posibles espacios o saltos de línea
      const accountSid = twilioAccountSid.value().trim();
      const authToken = twilioAuthToken.value().trim();
      const fromNumber = twilioPhoneNumber.value().trim();
      const toNumber = emergencyContactNumber.value().trim();

      // Inicialización del cliente de Twilio con los secretos resueltos en tiempo de ejecución
      const client = twilio(accountSid, authToken);

      logger.info(`Iniciando envío de SMS de emergencia para el episodio: ${episodeId}`, {
        episodeId,
        riskLevel,
        recipient: toNumber,
      });

      const message = await client.messages.create({
        contentSid: "HXfe5ab5f00277942d4d4200328b4d403c",
        contentVariables: JSON.stringify({
          "1": `Alerta GlycoPulse - Riesgo ${riskLevel} (${userName})`,
          "2": symptoms ? `Sintomas: ${symptoms}` : 'Verificar estado del usuario',
        }),
        from: `whatsapp:${fromNumber}`,
        to: `whatsapp:${toNumber}`,
      });

      logger.info(`SMS de emergencia enviado con éxito para el episodio ${episodeId}. SID: ${message.sid}`, {
        messageSid: message.sid,
        status: message.status,
      });
    } catch (error) {
      logger.error(`Error al enviar el SMS de emergencia para el episodio ${episodeId}:`, {
        error: error.message || error,
        stack: error.stack,
      });
    }
  }
);
