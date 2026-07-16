package com.manageeat.app;

import android.content.pm.ActivityInfo;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Orientação por tipo de aparelho: telemóvel fica travado em portrait,
        // tablet roda livre. O valor vem dos resources (values/bools.xml vs
        // values-sw600dp/) — é o Android que escolhe pelo tamanho do ecrã.
        if (getResources().getBoolean(R.bool.portrait_only)) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        }
    }
}
