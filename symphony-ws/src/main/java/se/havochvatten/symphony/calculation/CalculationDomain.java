package se.havochvatten.symphony.calculation;

import it.geosolutions.jaiext.utilities.ImageLayout2;
import org.geotools.coverage.grid.GridEnvelope2D;
import org.geotools.coverage.grid.GridGeometry2D;
import org.geotools.geometry.jts.ReferencedEnvelope;
import org.locationtech.jts.geom.Envelope;
import javax.media.jai.ImageLayout;

/** Native calculation pixel bounds, including the existing integer truncation.
 * Shared with read-only exports; changing rounding here changes native results. */
public final class CalculationDomain {
    public static GridGeometry2D geometry(Envelope envelope, ReferencedEnvelope target) {
        return new GridGeometry2D(new GridEnvelope2D((int) envelope.getMinX(), (int) envelope.getMinY(),
            (int) envelope.getWidth(), (int) envelope.getHeight()), target);
    }
    public static ImageLayout layout(Envelope envelope) {
        return new ImageLayout2((int) envelope.getMinX(), (int) envelope.getMinY(),
            (int) envelope.getWidth(), (int) envelope.getHeight());
    }
    private CalculationDomain() {}
}
