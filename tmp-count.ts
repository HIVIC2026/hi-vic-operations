import rows from "/tmp/spots.json";
import { leadRank, SPOT_RANK_LABEL } from "./src/lib/spot-saved-rank.core";
import { savedInsulationTap, declaredInsulationDetail, insulationDetailRoute } from "./src/lib/insulation-details.core";
import { buildDecadeFromAnswers } from "./src/lib/build-decade.core";
import * as ext from "./src/lib/launch-campaign.server";
